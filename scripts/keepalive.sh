#!/bin/bash
# 社交媒体保活脚本 - 使用 agent-browser (Playwright)
# 架构：连接到常驻 Chrome (CDP 9222)，登录态自动保留在 PVC
# 用法: ./keepalive.sh [platform1] [platform2] ... 或 ./keepalive.sh all

set -e

export PATH="$HOME/.openclaw/tools/bin:$PATH"
LOG_FILE="$HOME/.openclaw/data/social-media-hub/logs/keepalive.log"
CDP_PORT=9222

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 检查 Chrome 是否运行
check_chrome() {
    if ! curl -s "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
        log "❌ Chrome 未运行或 CDP 端口不可用"
        return 1
    fi
    return 0
}

# CDP 导航函数（替代 agent-browser open）
navigate_to() {
    local url="$1"
    node -e "
const WebSocket = require('ws');
const http = require('http');
http.get('http://localhost:$CDP_PORT/json/list', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const pages = JSON.parse(data);
    const page = pages.find(p => p.type === 'page') || pages[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({id: 1, method: 'Page.navigate', params: {url: '$url'}}));
    });
    ws.on('message', (msg) => { ws.close(); });
  });
});
" 2>/dev/null
}
get_page_content() {
    node -e "
const WebSocket = require('ws');
const http = require('http');

http.get('http://localhost:$CDP_PORT/json/list', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const pages = JSON.parse(data);
    const page = pages.find(p => p.type === 'page') || pages[0];
    if (!page) {
      console.log('');
      process.exit(0);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression: 'document.body.innerText'}}));
    });
    ws.on('message', (msg) => {
      const result = JSON.parse(msg);
      if (result.result && result.result.result && result.result.result.value) {
        console.log(result.result.result.value);
      }
      ws.close();
    });
  });
});
"
}

# B站保活
keepalive_bilibili() {
    log "🔄 B站保活..."
    
    # 访问 API 检查登录状态
    navigate_to "https://api.bilibili.com/x/web-interface/nav"
    sleep 3
    
    CONTENT=$(get_page_content)
    
    if echo "$CONTENT" | grep -q '"code":0'; then
        USERNAME=$(echo "$CONTENT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['uname'])" 2>/dev/null || echo "未知")
        log "✅ B站保活成功 - 用户: $USERNAME"
        return 0
    else
        log "❌ B站未登录或 Cookie 已过期"
        log "   请运行: scripts/login-bilibili.sh"
        return 1
    fi
}

# Twitter/X 保活
keepalive_twitter() {
    log "🔄 Twitter/X 保活..."
    
    navigate_to "https://x.com/home"
    sleep 5
    
    # 检查页面标题
    TITLE=$(curl -s http://localhost:$CDP_PORT/json/list | python3 -c "import sys,json; pages=json.load(sys.stdin); p=next((x for x in pages if x['type']=='page'), None); print(p['title'] if p else '')" 2>/dev/null || echo "")
    
    if echo "$TITLE" | grep -qi "home\|/ x\|twitter"; then
        log "✅ Twitter/X 保活成功"
        return 0
    else
        log "❌ Twitter/X 未登录或 Cookie 已过期"
        return 1
    fi
}

# LinkedIn 保活
keepalive_linkedin() {
    log "🔄 LinkedIn 保活..."
    
    navigate_to "https://www.linkedin.com/feed"
    sleep 3
    
    TITLE=$(curl -s http://localhost:$CDP_PORT/json/list | python3 -c "import sys,json; pages=json.load(sys.stdin); p=next((x for x in pages if x['type']=='page'), None); print(p['title'] if p else '')" 2>/dev/null || echo "")
    
    if echo "$TITLE" | grep -qi "feed\|linkedin"; then
        log "✅ LinkedIn 保活成功"
        return 0
    else
        log "❌ LinkedIn 未登录或 Cookie 已过期"
        return 1
    fi
}

# Reddit 保活
keepalive_reddit() {
    log "🔄 Reddit 保活..."
    
    navigate_to "https://www.reddit.com"
    sleep 3
    
    TITLE=$(curl -s http://localhost:$CDP_PORT/json/list | python3 -c "import sys,json; pages=json.load(sys.stdin); p=next((x for x in pages if x['type']=='page'), pages[0]); print(p['title'])" 2>/dev/null || echo "")
    
    if echo "$TITLE" | grep -qi "reddit"; then
        log "✅ Reddit 保活成功"
        return 0
    else
        log "❌ Reddit 未登录或 Cookie 已过期"
        return 1
    fi
}

# RedNote 保活
keepalive_rednote() {
    log "🔄 RedNote 保活..."
    
    navigate_to "https://www.xiaohongshu.com/explore"
    sleep 3
    
    TITLE=$(curl -s http://localhost:$CDP_PORT/json/list | python3 -c "import sys,json; pages=json.load(sys.stdin); p=next((x for x in pages if x['type']=='page'), pages[0]); print(p['title'])" 2>/dev/null || echo "")
    
    if echo "$TITLE" | grep -qi "小红书\|rednote"; then
        log "✅ RedNote 保活成功"
        return 0
    else
        log "❌ RedNote 未登录或 Cookie 已过期"
        return 1
    fi
}

# TikTok 保活
keepalive_tiktok() {
    log "🔄 TikTok 保活..."
    
    navigate_to "https://www.tiktok.com/@acg_ai"
    sleep 3
    
    TITLE=$(curl -s http://localhost:$CDP_PORT/json/list | python3 -c "import sys,json; pages=json.load(sys.stdin); p=next((x for x in pages if x['type']=='page'), pages[0]); print(p['title'])" 2>/dev/null || echo "")
    
    if echo "$TITLE" | grep -qi "tiktok"; then
        log "✅ TikTok 保活成功"
        return 0
    else
        log "❌ TikTok 未登录或 Cookie 已过期"
        return 1
    fi
}

# 主逻辑
mkdir -p "$(dirname "$LOG_FILE")"

if [ $# -eq 0 ]; then
    echo "用法: $0 [platform1] [platform2] ... 或 $0 all"
    echo ""
    echo "支持的平台:"
    echo "  bilibili  - B站"
    echo "  twitter   - Twitter/X"
    echo "  linkedin  - LinkedIn"
    echo "  reddit    - Reddit"
    echo "  rednote   - RedNote (小红书)"
    echo "  tiktok    - TikTok"
    echo "  all       - 所有平台"
    echo ""
    echo "架构: 连接到常驻 Chrome (CDP $CDP_PORT)，登录态自动保留在 PVC"
    exit 1
fi

# 检查 Chrome
if ! check_chrome; then
    exit 1
fi

FAILED=0

for platform in "$@"; do
    case "$platform" in
        bilibili)
            keepalive_bilibili || ((FAILED++))
            ;;
        twitter)
            keepalive_twitter || ((FAILED++))
            ;;
        linkedin)
            keepalive_linkedin || ((FAILED++))
            ;;
        reddit)
            keepalive_reddit || ((FAILED++))
            ;;
        rednote)
            keepalive_rednote || ((FAILED++))
            ;;
        tiktok)
            keepalive_tiktok || ((FAILED++))
            ;;
        all)
            keepalive_bilibili || ((FAILED++))
            keepalive_twitter || ((FAILED++))
            keepalive_linkedin || ((FAILED++))
            keepalive_reddit || ((FAILED++))
            keepalive_rednote || ((FAILED++))
            keepalive_tiktok || ((FAILED++))
            ;;
        *)
            log "❌ 未知平台: $platform"
            ;;
    esac
done

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "保活完成，失败: $FAILED"

if [ $FAILED -gt 0 ]; then
    log "💡 提示: 运行对应的 login-*.sh 脚本重新登录"
    exit 1
fi
