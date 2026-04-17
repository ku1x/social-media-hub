#!/bin/bash
# B站登录脚本 - 使用 agent-browser (Playwright)
# 架构：连接到常驻 Chrome (CDP 9222)，登录态自动保留在 PVC
# 用法: ./login-bilibili.sh

set -e

PLATFORM="bilibili"
LOGIN_URL="https://passport.bilibili.com/login"
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

# 1. 导航到登录页（使用 CDP 直接导航）
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

# 2. 截图（使用 Node.js 直接调用 CDP）
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
echo "请在浏览器中打开上述链接，扫码或输入验证码登录。"
echo "登录成功后，按 Enter 继续..."
read -r

# 4. 检查登录状态
echo "🔍 检查登录状态..."

# 导航到 API 接口
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
        params: {url: 'https://api.bilibili.com/x/web-interface/nav'}
      }));
    });
    ws.on('message', (msg) => {
      ws.close();
    });
  });
});
"

sleep 2

# 获取页面内容
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

if echo "$CONTENT" | grep -q '"code":0'; then
    echo "✅ 登录成功！"
    echo "💾 登录态已自动保存在 Chrome profile (PVC 持久化)"
    
    # 显示用户信息
    echo ""
    echo "👤 用户信息:"
    echo "$CONTENT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data['code'] == 0:
        info = data['data']
        print(f\"  用户名: {info['uname']}\")
        print(f\"  UID: {info['mid']}\")
        print(f\"  等级: Lv{info['level_info']['current_level']}\")
        print(f\"  硬币: {info['money']}\")
        print(f\"  VIP: {'是' if info['vipStatus'] else '否'}\")
except:
    pass
"
else
    echo "❌ 登录失败，请重试"
    exit 1
fi
