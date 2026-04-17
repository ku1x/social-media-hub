#!/usr/bin/env node
/**
 * WeChat Article to Markdown — 微信公众号文章抓取 & Markdown 转换
 * 
 * 改造自: https://github.com/jackwener/wechat-article-to-markdown
 * 改动: 用已有的 Chrome CDP 替代 Camoufox，无需额外安装浏览器
 * 
 * 用法:
 *   node wechat-article-to-markdown.js "https://mp.weixin.qq.com/s/xxxxxx"
 *   node wechat-article-to-markdown.js "https://mp.weixin.qq.com/s/xxxxxx" -o /tmp/output
 * 
 * 要求:
 *   - Chrome 运行在 CDP port 9222
 *   - uv 已安装（用于运行 Python 处理脚本）
 */

const { WebSocket } = require('ws');
const http = require('http');
const { execSync } = require('child_process');
const path = require('path');

const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const TIMEOUT = 30000;

// ─── CDP Helper ───────────────────────────────────────────────
function createCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const handlers = new Map();

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && handlers.has(msg.id)) {
      handlers.get(msg.id)(msg);
      handlers.delete(msg.id);
    }
  });

  return {
    ready: new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    }),
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const msgId = id++;
      const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), TIMEOUT);
      handlers.set(msgId, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    }),
    close: () => ws.close(),
  };
}

async function getCDPPage() {
  const pages = await new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  let page = pages.find(p => p.type === 'page');
  if (!page) throw new Error('No browser tab available');
  return page;
}

// ─── Fetch article HTML via Chrome CDP ────────────────────────
async function fetchArticleHTML(url) {
  console.log('🌐 用 Chrome CDP 抓取文章...');
  const page = await getCDPPage();
  const cdp = createCDP(page.webSocketDebuggerUrl);
  await cdp.ready;

  // Navigate to WeChat article
  await cdp.send('Page.navigate', { url });
  
  // Wait for page to load
  await new Promise(r => setTimeout(r, 3000));
  
  // Check if we hit captcha page
  const checkResult = await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      if (document.querySelector('#activity-name')) return 'HAS_CONTENT';
      if (document.querySelector('.weui-msg__title')) return 'CAPTCHA';
      return 'LOADING';
    })()`,
    returnByValue: true,
  });
  
  const status = checkResult.result?.result?.value;
  
  if (status === 'CAPTCHA') {
    console.log('⚠️  微信验证码页面！请在 noVNC 中完成验证...');
    console.log('   等待验证完成（最长 120 秒）...');
    
    // Wait for user to complete captcha (poll every 2s, max 120s)
    const startTime = Date.now();
    const maxWait = 120000;
    
    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, 2000));
      
      const pollResult = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          if (document.querySelector('#activity-name')) return 'HAS_CONTENT';
          if (document.querySelector('.weui-msg__title')) return 'CAPTCHA';
          return 'LOADING';
        })()`,
        returnByValue: true,
      });
      
      if (pollResult.result?.result?.value === 'HAS_CONTENT') {
        console.log('✅ 验证通过！文章已加载');
        break;
      }
      
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed % 10 === 0) {
        console.log(`   仍在等待验证... (${elapsed}s)`);
      }
    }
    
    // Final check
    const finalCheck = await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('#activity-name') ? 'HAS_CONTENT' : 'NO_CONTENT'`,
      returnByValue: true,
    });
    
    if (finalCheck.result?.result?.value !== 'HAS_CONTENT') {
      throw new Error('验证超时或失败，请重试');
    }
  } else {
    // Wait for #js_content (article body)
    try {
      await cdp.send('Runtime.evaluate', {
        expression: `new Promise((resolve) => {
          const check = () => {
            if (document.querySelector('#js_content')) { resolve('loaded'); return; }
            setTimeout(check, 500);
          };
          check();
          setTimeout(() => resolve('timeout'), 10000);
        })`,
        awaitPromise: true,
        timeout: 15000
      });
    } catch (e) {
      // Timeout is ok, try to get content anyway
    }
  }

  // Extra wait for JS execution
  await new Promise(r => setTimeout(r, 2000));

  // Get full HTML
  const htmlResult = await cdp.send('Runtime.evaluate', {
    expression: 'document.documentElement.outerHTML',
    returnByValue: true,
  });

  const html = htmlResult.result?.result?.value;
  if (!html) throw new Error('Failed to get page HTML');

  cdp.close();
  console.log('✅ HTML 抓取完成');
  return html;
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('用法: node wechat-article-to-markdown.js "https://mp.weixin.qq.com/s/xxxxxx" [-o output_dir]');
    process.exit(1);
  }

  let url = args[0];
  let outputDir = process.cwd() + '/output';

  const outputIdx = args.indexOf('-o');
  if (outputIdx !== -1 && args[outputIdx + 1]) {
    outputDir = path.resolve(args[outputIdx + 1]);
  }

  // Step 1: Fetch HTML via Chrome CDP
  const html = await fetchArticleHTML(url);

  // Step 2: Process with Python via uv run
  console.log('📝 处理文章内容...');
  
  const pythonInput = JSON.stringify({
    html: html,
    output_dir: outputDir,
    url: url,
  });

  const scriptDir = __dirname;
  const pythonScript = path.join(scriptDir, 'wechat_process.py');
  const uvPath = process.env.UV_PATH || path.join(process.env.HOME, '.openclaw/tools/uv/uv');

  const result = execSync(
    `${uvPath} run ${pythonScript}`,
    {
      input: pythonInput,
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'utf-8',
      env: { ...process.env, HOME: process.env.HOME },
    }
  );

  // Parse result
  const lines = result.trim().split('\n');
  const jsonLine = lines.find(l => l.trim().startsWith('{'));
  if (jsonLine) {
    try {
      const info = JSON.parse(jsonLine.trim());
      console.log(`\n✅ 完成！`);
      console.log(`📄 标题: ${info.title}`);
      console.log(`📊 约 ${info.chars} 字符`);
      console.log(`📁 文件: ${info.path}`);
    } catch (e) {
      console.log(result);
    }
  } else {
    console.log(result);
  }
}

main().catch(err => {
  console.error(`❌ 错误: ${err.message}`);
  process.exit(1);
});
