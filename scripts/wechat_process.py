# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "markdownify",
#     "beautifulsoup4",
#     "httpx",
# ]
# ///
"""Process WeChat article HTML → Markdown (called by Node.js wrapper)"""

from __future__ import annotations
import sys
import json
import re
import html as html_mod
import asyncio
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from datetime import datetime, timezone, timedelta

import httpx
import markdownify
from bs4 import BeautifulSoup

IMAGE_CONCURRENCY = 5

def format_timestamp(ts):
    tz = timezone(timedelta(hours=8))
    dt = datetime.fromtimestamp(ts, tz=tz)
    return dt.strftime("%Y-%m-%d %H:%M:%S")

def extract_publish_time(html_text):
    m = re.search(r"create_time\s*:\s*JsDecode\('([^']+)'\)", html_text)
    if m:
        try:
            ts = int(m.group(1))
            if ts > 0: return format_timestamp(ts)
        except ValueError: return m.group(1)
    m = re.search(r"create_time\s*:\s*'(\d+)'", html_text)
    if m: return format_timestamp(int(m.group(1)))
    m = re.search(r'create_time\s*[:=]\s*["\']?(\d+)["\']?', html_text)
    if m: return format_timestamp(int(m.group(1)))
    return ""

def extract_metadata(soup, html_text):
    title_el = soup.select_one("#activity-name")
    author_el = soup.select_one("#js_name")
    return {
        "title": title_el.get_text(strip=True) if title_el else "",
        "author": author_el.get_text(strip=True) if author_el else "",
        "publish_time": extract_publish_time(html_text),
    }

def process_content(soup):
    content_el = soup.select_one("#js_content")
    if not content_el: return "", [], []
    for img in content_el.find_all("img"):
        data_src = img.get("data-src")
        if data_src: img["src"] = data_src
    code_blocks = []
    for el in content_el.select(".code-snippet__fix"):
        for line_idx in el.select(".code-snippet__line-index"):
            line_idx.decompose()
        pre = el.select_one("pre[data-lang]")
        lang = pre.get("data-lang", "") if pre else ""
        lines = []
        for code_tag in el.find_all("code"):
            text = code_tag.get_text()
            if re.match(r"^[ce]?ounter\(line", text): continue
            lines.append(text)
        if not lines: lines.append(el.get_text())
        placeholder = f"CODEBLOCK-PLACEHOLDER-{len(code_blocks)}"
        code_blocks.append({"lang": lang, "code": "\n".join(lines)})
        el.replace_with(soup.new_tag("p", string=placeholder))
    for sel in ("script", "style", ".qr_code_pc", ".reward_area"):
        for tag in content_el.select(sel): tag.decompose()
    img_urls = []
    seen = set()
    for img in content_el.find_all("img", src=True):
        src = img["src"]
        if src not in seen:
            seen.add(src)
            img_urls.append(src)
    return str(content_el), code_blocks, img_urls

def convert_to_markdown(content_html, code_blocks):
    md = markdownify.markdownify(
        content_html, heading_style="ATX", bullets="-",
        convert=["p","h1","h2","h3","h4","h5","h6","strong","em","a","img",
                 "ul","ol","li","blockquote","br","hr","table","thead",
                 "tbody","tr","th","td","pre","code"],
    )
    for i, block in enumerate(code_blocks):
        placeholder = f"CODEBLOCK-PLACEHOLDER-{i}"
        fenced = f"\n```{block['lang']}\n{block['code']}\n```\n"
        md = md.replace(placeholder, fenced)
    md = md.replace("\u00a0", " ")
    md = re.sub(r"\n{4,}", "\n\n\n", md)
    md = re.sub(r"[ \t]+$", "", md, flags=re.MULTILINE)
    return md

async def download_image(client, img_url, img_dir, index, semaphore):
    async with semaphore:
        try:
            url = img_url if not img_url.startswith("//") else f"https:{img_url}"
            ext_match = re.search(r"wx_fmt=(\w+)", url) or re.search(r"\.(\w{3,4})(?:\?|$)", url)
            ext = ext_match.group(1) if ext_match else "png"
            filename = f"img_{index:03d}.{ext}"
            filepath = img_dir / filename
            resp = await client.get(url, headers={"Referer": "https://mp.weixin.qq.com/"}, timeout=15.0)
            resp.raise_for_status()
            filepath.write_bytes(resp.content)
            return img_url, f"images/{filename}"
        except Exception as e:
            print(f"  ⚠ 图片下载失败: {e}", file=sys.stderr)
            return img_url, None

async def download_all_images(img_urls, img_dir):
    if not img_urls: return {}
    print(f"🖼  下载 {len(img_urls)} 张图片 (并发 {IMAGE_CONCURRENCY})...", file=sys.stderr)
    semaphore = asyncio.Semaphore(IMAGE_CONCURRENCY)
    async with httpx.AsyncClient() as client:
        tasks = [download_image(client, url, img_dir, i+1, semaphore) for i, url in enumerate(img_urls)]
        results = await asyncio.gather(*tasks)
    url_map = {}
    for remote_url, local_path in results:
        if local_path: url_map[remote_url] = local_path
    downloaded = sum(1 for v in url_map.values() if v)
    print(f"  ✅ {downloaded}/{len(img_urls)}", file=sys.stderr)
    return url_map

def replace_image_urls(md, url_map):
    for remote_url, local_path in url_map.items():
        pattern = re.compile(r"!\[([^\]]*)\]\(" + re.escape(remote_url) + r"\)")
        md = pattern.sub(lambda m: f"![{m.group(1)}]({local_path})", md)
    return md

def build_markdown(meta, body_md):
    lines = [f"# {meta['title']}", ""]
    if meta.get("author"): lines.append(f"> 公众号: {meta['author']}")
    if meta.get("publish_time"): lines.append(f"> 发布时间: {meta['publish_time']}")
    if meta.get("source_url"): lines.append(f"> 原文链接: {meta['source_url']}")
    if meta.get("author") or meta.get("publish_time") or meta.get("source_url"): lines.append("")
    lines.extend(["---", ""])
    return "\n".join(lines) + body_md

async def process_html(html_content, output_dir, source_url):
    soup = BeautifulSoup(html_content, "html.parser")
    meta = extract_metadata(soup, html_content)
    if not meta["title"]:
        print("❌ 未能提取到文章标题", file=sys.stderr)
        sys.exit(1)
    meta["source_url"] = source_url
    print(f"📄 标题: {meta['title']}", file=sys.stderr)
    print(f"👤 作者: {meta['author']}", file=sys.stderr)
    print(f"📅 时间: {meta['publish_time']}", file=sys.stderr)

    content_html, code_blocks, img_urls = process_content(soup)
    if not content_html:
        print("❌ 未能提取到正文内容", file=sys.stderr)
        sys.exit(1)

    md = convert_to_markdown(content_html, code_blocks)
    safe_title = re.sub(r'[/\\?%*:|"<>]', "_", meta["title"])[:80]
    article_dir = output_dir / safe_title
    img_dir = article_dir / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    url_map = await download_all_images(img_urls, img_dir)
    md = replace_image_urls(md, url_map)

    result = build_markdown(meta, md)
    md_path = article_dir / f"{safe_title}.md"
    md_path.write_text(result, encoding="utf-8")
    print(f"✅ 已保存: {md_path}", file=sys.stderr)
    print(json.dumps({"path": str(md_path), "title": meta["title"], "chars": len(md)}))

def main():
    data = json.loads(sys.stdin.read())
    html_content = data["html"]
    output_dir = Path(data["output_dir"])
    source_url = data["url"]
    asyncio.run(process_html(html_content, output_dir, source_url))

if __name__ == "__main__":
    main()
