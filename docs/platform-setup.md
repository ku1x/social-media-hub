# 社交平台配置指南

本文档记录了 2026-04-10 配置各社交平台 CLI 工具的完整流程。

## 📋 配置清单

| 平台 | 工具 | 安装方式 | 认证方式 |
|------|------|---------|---------|
| B站 | bili-cli | uv tool install | Cookie |
| RedNote | rednote-cli | GitHub (ku1x/rednote-cli) | Cookie |
| LinkedIn | linkedin-cli | 自定义脚本 | Cookie |
| Twitter/X | twitter-cli | uv tool install | Cookie + 环境变量 |
| Reddit | rdt-cli | uv tool install | Cookie (JWT) |

## 🔧 安装流程

### 1. B站 (bili-cli)

```bash
# 安装
uv tool install bilibili-cli

# 持久化
mkdir -p ~/.openclaw/tools/bili-cli
cp -r ~/.local/share/uv/tools/bili-cli/* ~/.openclaw/tools/bili-cli/
ln -sf ~/.openclaw/tools/bili-cli/bin/bili ~/.openclaw/tools/bin/bili

# 配置 Cookie
mkdir -p ~/.openclaw/data/bilibili-cli
cat > ~/.openclaw/data/bilibili-cli/credential.json << 'EOF'
{
  "sessdata": "<SESSDATA>",
  "bili_jct": "<bili_jct>",
  "saved_at": $(date +%s)
}
EOF

# 创建符号链接
mkdir -p ~/.bilibili-cli
ln -sf ~/.openclaw/data/bilibili-cli/credential.json ~/.bilibili-cli/

# 测试
bili hot -n 1 --yaml
```

### 2. RedNote (rednote-cli)

```bash
# 安装（从 GitHub）
uv tool install git+https://github.com/ku1x/rednote-cli.git

# 持久化
mkdir -p ~/.openclaw/tools/rednote-cli
cp -r ~/.local/share/uv/tools/rednote-cli/* ~/.openclaw/tools/rednote-cli/
ln -sf ~/.openclaw/tools/rednote-cli/bin/rednote ~/.openclaw/tools/bin/rednote

# 配置 Cookie
mkdir -p ~/.openclaw/data/rednote-cli
cat > ~/.openclaw/data/rednote-cli/cookies.json << 'EOF'
{
  "a1": "<a1>",
  "webId": "<webId>",
  "web_session": "<web_session>",
  "saved_at": $(date +%s)
}
EOF

# 创建符号链接
mkdir -p ~/.rednote-cli
ln -sf ~/.openclaw/data/rednote-cli/cookies.json ~/.rednote-cli/

# 测试
rednote hot --yaml
```

### 3. LinkedIn (linkedin-cli)

```bash
# 创建自定义 CLI
cat > ~/.openclaw/tools/bin/linkedin-cli << 'EOF'
#!/bin/bash
COOKIE_FILE="$HOME/.openclaw/data/linkedin/cookies.json"

if [ -f "$COOKIE_FILE" ]; then
    LI_AT=$(python3 -c "import json; print(json.load(open('$COOKIE_FILE'))['li_at'])")
    JSESSIONID=$(python3 -c "import json; print(json.load(open('$COOKIE_FILE'))['JSESSIONID'])")
else
    echo "Error: Cookie file not found"
    exit 1
fi

BASE_URL="https://www.linkedin.com/voyager/api"

case "$1" in
    me|profile)
        curl -s \
            -b "li_at=${LI_AT}; JSESSIONID=${JSESSIONID}" \
            -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
            -H "csrf-token: ${JSESSIONID}" \
            -H "x-li-lang: en_US" \
            -H "x-restli-protocol-version: 2.0.0" \
            "${BASE_URL}/me" | python3 -m json.tool
        ;;
    search)
        query="$2"
        curl -s \
            -b "li_at=${LI_AT}; JSESSIONID=${JSESSIONID}" \
            -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
            -H "csrf-token: ${JSESSIONID}" \
            -H "x-li-lang: en_US" \
            -H "x-restli-protocol-version: 2.0.0" \
            "${BASE_URL}/search/blended?keywords=${query}" | python3 -m json.tool
        ;;
    *)
        echo "LinkedIn CLI"
        echo "Usage: linkedin-cli <command>"
        echo ""
        echo "Commands:"
        echo "  me, profile  - Get current user profile"
        echo "  search <q>   - Search LinkedIn"
        ;;
esac
EOF

chmod +x ~/.openclaw/tools/bin/linkedin-cli

# 配置 Cookie
mkdir -p ~/.openclaw/data/linkedin
cat > ~/.openclaw/data/linkedin/cookies.json << 'EOF'
{
  "li_at": "<li_at>",
  "JSESSIONID": "<JSESSIONID>",
  "saved_at": $(date +%s)
}
EOF

# 测试
linkedin-cli me
```

### 4. Twitter/X (twitter-cli)

```bash
# 安装
uv tool install twitter-cli

# 持久化
mkdir -p ~/.openclaw/tools/twitter-cli
cp -r ~/.local/share/uv/tools/twitter-cli/* ~/.openclaw/tools/twitter-cli/
ln -sf ~/.openclaw/tools/twitter-cli/bin/twitter ~/.openclaw/tools/bin/twitter

# 配置 Cookie
mkdir -p ~/.openclaw/data/twitter
cat > ~/.openclaw/data/twitter/cookies.json << 'EOF'
{
  "auth_token": "<auth_token>",
  "ct0": "<ct0>",
  "saved_at": $(date +%s)
}
EOF

# 设置环境变量（添加到 .bashrc）
echo 'export TWITTER_AUTH_TOKEN="<auth_token>"' >> ~/.bashrc
echo 'export TWITTER_CT0="<ct0>"' >> ~/.bashrc

# 测试
export TWITTER_AUTH_TOKEN="<auth_token>"
export TWITTER_CT0="<ct0>"
twitter status
```

### 5. Reddit (rdt-cli)

```bash
# 安装
uv tool install rdt-cli

# 持久化
mkdir -p ~/.openclaw/tools/rdt-cli
cp -r ~/.local/share/uv/tools/rdt-cli/* ~/.openclaw/tools/rdt-cli/
ln -sf ~/.openclaw/tools/rdt-cli/bin/rdt ~/.openclaw/tools/bin/rdt

# 配置 Cookie
mkdir -p ~/.openclaw/data/rdt-cli
mkdir -p ~/.config/rdt-cli
cat > ~/.config/rdt-cli/credential.json << 'EOF'
{
  "cookies": {
    "reddit_session": "<JWT_TOKEN>"
  },
  "source": "manual",
  "saved_at": $(date +%s)
}
EOF

# 复制到持久化目录
cp ~/.config/rdt-cli/credential.json ~/.openclaw/data/rdt-cli/

# 测试
rdt status
rdt popular -n 3 --yaml
```

## 🍎 Safari 获取 Cookie 详细步骤

### 启用开发者菜单

1. 打开 Safari
2. Safari → 设置（或偏好设置）
3. 点击「高级」标签
4. 勾选「在菜单栏中显示开发菜单」

### 获取 Cookie

**方法一：存储面板**
1. 登录目标网站
2. 按 `⌘ + Option + I` 打开开发者工具
3. 点击「存储」标签
4. 展开左侧「Cookie」
5. 选择对应域名
6. 找到需要的 Cookie 值

**方法二：控制台**
1. 登录目标网站
2. 按 `⌘ + Option + I` 打开开发者工具
3. 点击「控制台」标签
4. 输入以下代码：

```javascript
// 获取单个 Cookie
document.cookie.split('; ').find(c => c.startsWith('<cookie_name>='))

// 获取所有 Cookie
document.cookie

// 获取并解析
document.cookie.split('; ').reduce((acc, c) => {
  const [k, v] = c.split('=');
  acc[k] = v;
  return acc;
}, {})
```

### 各平台 Cookie 名称

| 平台 | 登录地址 | Cookie 名称 |
|------|---------|------------|
| B站 | passport.bilibili.com | `SESSDATA`, `bili_jct` |
| RedNote | xiaohongshu.com | `a1`, `webId`, `web_session` |
| LinkedIn | linkedin.com | `li_at`, `JSESSIONID` |
| Twitter/X | x.com | `auth_token`, `ct0` |
| Reddit | reddit.com | `reddit_session` |

## 🔄 Pod 重启后恢复

### 自动恢复

`.bashrc` 已配置自动恢复：

```bash
# 恢复工具 PATH
export PATH="$HOME/.openclaw/tools/bin:$HOME/.openclaw/tools/bili-cli/bin:$HOME/.openclaw/tools/rednote-cli/bin:$HOME/.openclaw/tools/twitter-cli/bin:$HOME/.openclaw/tools/rdt-cli/bin:$PATH"

# 恢复符号链接
mkdir -p ~/.bilibili-cli
ln -sf ~/.openclaw/data/bilibili-cli/credential.json ~/.bilibili-cli/

mkdir -p ~/.rednote-cli
ln -sf ~/.openclaw/data/rednote-cli/cookies.json ~/.rednote-cli/

mkdir -p ~/.config/rdt-cli
ln -sf ~/.openclaw/data/rdt-cli/credential.json ~/.config/rdt-cli/

# Twitter 环境变量
export TWITTER_AUTH_TOKEN="<auth_token>"
export TWITTER_CT0="<ct0>"
```

### 手动恢复

```bash
# 设置 PATH
export PATH="$HOME/.openclaw/tools/bin:$PATH"

# 创建符号链接
mkdir -p ~/.bilibili-cli && ln -sf ~/.openclaw/data/bilibili-cli/credential.json ~/.bilibili-cli/
mkdir -p ~/.rednote-cli && ln -sf ~/.openclaw/data/rednote-cli/cookies.json ~/.rednote-cli/
mkdir -p ~/.config/rdt-cli && ln -sf ~/.openclaw/data/rdt-cli/credential.json ~/.config/rdt-cli/

# Twitter 环境变量
source ~/.bashrc
```

## 📅 每日保活

### 保活命令

```bash
# B站
bili hot -n 1 --yaml

# RedNote
rednote hot --yaml

# LinkedIn
linkedin-cli me

# Twitter/X
twitter feed -n 5

# Reddit
rdt popular -n 3 --yaml

# V2EX
curl -s "https://www.v2ex.com/api/topics/hot.json" | python3 -m json.tool
```

### 过期检测

| 平台 | 错误信号 | 处理方式 |
|------|---------|---------|
| B站 | 401, "未登录" | 更新 SESSDATA, bili_jct |
| RedNote | 401, "cookie expired" | 更新 web_session |
| LinkedIn | 302, CSRF 错误 | 更新 li_at |
| Twitter | "not_authenticated" | 更新 auth_token, ct0 |
| Reddit | 403, "forbidden" | 更新 reddit_session |

## ⚠️ 常见问题

### Q: Cookie 在哪里获取？

A: 使用 Safari 开发者工具，详见上文「Safari 获取 Cookie 详细步骤」。

### Q: Cookie 多久过期？

A: 各平台不同：
- B站: 约 30 天
- RedNote: 约 7-30 天
- LinkedIn: 约 90 天
- Twitter: 约 7 天
- Reddit: 约 30 天

### Q: Pod 重启后配置会丢失吗？

A: 不会。所有配置保存在 `~/.openclaw/data/`，这是持久化目录。`.bashrc` 会自动恢复符号链接和环境变量。

### Q: RedNote 和小红书有什么区别？

A: RedNote 是小红书海外版，使用 rednote-cli 工具。国内版小红书需要不同的配置。

---

**文档版本**: 1.0.0
**创建时间**: 2026-04-10
**作者**: OpenClaw
