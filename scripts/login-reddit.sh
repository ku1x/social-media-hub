#!/bin/bash
# Reddit 登录脚本 - 使用 agent-browser (Playwright)
# 架构：连接到常驻 Chrome (CDP 9222)，登录态自动保留在 PVC
# 用法: ./login-reddit.sh

set -e

PLATFORM="reddit"
LOGIN_URL="https://www.reddit.com/login/"
SCREENSHOT="/tmp/${PLATFORM}-login.png"
CDP_PORT=9222

echo "=== ${PLATFORM} 登录 ==="
echo "📍 架构: 连接到常驻 Chrome (CDP $CDP_PORT)，登录态自动保留在 PVC"

# 设置环境
export PATH="$HOME/.openclaw/tools/bin:$PATH"
export XDG_CONFIG_HOME="$HOME/.openclaw/config"
export GOG_KEYRING_PASSWORD="KuiClaw1997"

# 检查 Chrome 是否运行
if ! curl -s "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
    echo "❌ Chrome 未运行或 CDP 端口不可用"
    echo "   请检查 Chrome 进程 (PID 15) 是否正常"
    exit 1
fi

# 1. 导航到登录页
echo "📍 导航到登录页..."
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
      console.log('❌ 没有找到页面');
      process.exit(1);
    }
    
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1, 
        method: 'Page.navigate', 
        params: {url: '$LOGIN_URL'}
      }));
    });
    ws.on('message', (msg) => {
      const result = JSON.parse(msg);
      if (result.result) {
        console.log('✅ 导航成功');
      } else {
        console.log('❌ 导航失败:', result.error);
      }
      ws.close();
    });
  });
}).on('error', (err) => {
  console.log('❌ 连接失败:', err.message);
  process.exit(1);
});
"

sleep 3

# 2. 截图
echo "📸 截取登录页面..."
node -e "
const WebSocket = require('ws');
const fs = require('fs');
const http = require('http');

http.get('http://localhost:$CDP_PORT/json/list', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const pages = JSON.parse(data);
    const page = pages.find(p => p.type === 'page') || pages[0];
    if (!page) {
      console.log('❌ 没有找到页面');
      process.exit(1);
    }
    
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({id: 1, method: 'Page.captureScreenshot', params: {}}));
    });
    ws.on('message', (msg) => {
      const result = JSON.parse(msg);
      if (result.result && result.result.data) {
        fs.writeFileSync('$SCREENSHOT', Buffer.from(result.result.data, 'base64'));
        console.log('✅ 截图成功');
      } else {
        console.log('❌ 截图失败:', result.error || result);
      }
      ws.close();
    });
  });
}).on('error', (err) => {
  console.log('❌ 连接失败:', err.message);
  process.exit(1);
});
"

if [ ! -f "$SCREENSHOT" ]; then
    echo "❌ 截图失败"
    exit 1
fi

# 3. 上传到 Google Drive
echo "📤 上传截图到 Google Drive..."
RESULT=$(gog drive upload "$SCREENSHOT" --name "${PLATFORM}-login-$(date +%Y%m%d-%H%M%S).png" --account aikuiquark@gmail.com --json)
URL=$(echo "$RESULT" | python3 -c "import sys, json; print(json.load(sys.stdin)['file']['webViewLink'])")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📸 登录页面截图:"
echo "$URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "请在浏览器中打开上述链接，输入用户名和密码登录。"
echo "登录成功后，按 Enter 继续..."
read -r

# 4. 检查登录状态
echo "🔍 检查登录状态..."

# 导航到首页
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
      ws.send(JSON.stringify({
        id: 1, 
        method: 'Page.navigate', 
        params: {url: 'https://www.reddit.com/'}
      }));
    });
    ws.on('message', (msg) => {
      ws.close();
    });
  });
});
"

sleep 3

# 获取页面内容检查登录状态
CONTENT=$(node -e "
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
")

# 检查是否登录成功
if echo "$CONTENT" | grep -qi "popular\|home\|create post"; then
    echo "✅ 登录成功！"
    echo "💾 登录态已自动保存在 Chrome profile (PVC 持久化)"
    
    # 尝试获取用户名
    USERNAME=$(node -e "
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
      ws.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {
        expression: 'document.querySelector(\"[data-click-id=user\]\")?.innerText || document.querySelector(\"._2KotRmn9DgdA58Ikji2mnV\")?.innerText || \"\"'
      }}));
    });
    ws.on('message', (msg) => {
      const result = JSON.parse(msg);
      if (result.result?.result?.value) {
        console.log(result.result.result.value);
      }
      ws.close();
    });
  });
});
" 2>/dev/null || echo "")
    
    if [ -n "$USERNAME" ]; then
        echo ""
        echo "👤 用户: $USERNAME"
    fi
else
    echo "❌ 登录失败，请重试"
    exit 1
fi
