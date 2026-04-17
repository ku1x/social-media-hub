#!/bin/bash
# Twitter/X 登录脚本 - 使用 agent-browser (Playwright)
# 架构：连接到常驻 Chrome (CDP 9222)，登录态自动保留在 PVC
# 用法: ./login-twitter.sh [username] [password]

set -e

PLATFORM="twitter"
LOGIN_URL="https://x.com/login"
SCREENSHOT="/tmp/${PLATFORM}-login.png"
CDP_PORT=9222

USERNAME="${1:-}"
PASSWORD="${2:-}"

echo "=== ${PLATFORM} 登录 ==="
echo "📍 架构: 连接到常驻 Chrome (CDP $CDP_PORT)，登录态自动保留在 PVC"

# 设置环境
export PATH="$HOME/.openclaw/tools/bin:$PATH"
export XDG_CONFIG_HOME="$HOME/.openclaw/config"
export GOG_KEYRING_PASSWORD="KuiClaw1997"

# 检查 Chrome 是否运行
if ! curl -s "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
    echo "❌ Chrome 未运行或 CDP 端口不可用"
    exit 1
fi

# 截图函数
screenshot() {
    local output="$1"
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
        fs.writeFileSync('$output', Buffer.from(result.result.data, 'base64'));
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
}

# 上传截图函数
upload_screenshot() {
    local file="$1"
    local name="$2"
    gog drive upload "$file" --name "$name" --account aikuiquark@gmail.com --json | \
        python3 -c "import sys, json; print(json.load(sys.stdin)['file']['webViewLink'])"
}

# 1. 导航到登录页
echo "📍 导航到登录页..."
agent-browser --cdp $CDP_PORT open "$LOGIN_URL"
sleep 3

# 检查是否提供了用户名密码
if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
    echo "未提供用户名/密码，使用扫码登录..."
    
    # 截图上传
    screenshot "$SCREENSHOT"
    URL=$(upload_screenshot "$SCREENSHOT" "${PLATFORM}-login-$(date +%Y%m%d-%H%M%S).png")
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📸 登录页面截图:"
    echo "$URL"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "请在浏览器中打开上述链接，扫码登录。"
    echo "登录成功后，按 Enter 继续..."
    read -r
else
    echo "使用用户名/密码登录..."
    
    # 填写用户名
    agent-browser --cdp $CDP_PORT type "input[autocomplete='username']" "$USERNAME"
    sleep 1
    agent-browser --cdp $CDP_PORT click "button:has-text('Next')"
    sleep 2
    
    # 检查是否需要验证
    # TODO: 需要检测验证元素
    
    # 填写密码
    agent-browser --cdp $CDP_PORT type "input[name='password']" "$PASSWORD"
    sleep 1
    agent-browser --cdp $CDP_PORT click "button[data-testid='LoginForm_Login_Button']"
    sleep 3
fi

# 等待登录成功
echo "🔍 检查登录状态..."
agent-browser --cdp $CDP_PORT open "https://x.com/home"
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
    if (!page) { console.log(''); process.exit(0); }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression: 'document.body.innerText'}}));
    });
    ws.on('message', (msg) => {
      const result = JSON.parse(msg);
      if (result.result && result.result.result) {
        console.log(result.result.result.value || '');
      }
      ws.close();
    });
  });
});
")

if echo "$CONTENT" | grep -qi "home\|timeline\|tweet"; then
    echo "✅ 登录成功！"
    echo "💾 登录态已自动保存在 Chrome profile (PVC 持久化)"
else
    echo "❌ 登录失败，请检查用户名/密码或尝试扫码登录"
    exit 1
fi
