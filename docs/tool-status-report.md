# Social Media Hub 工具状态报告

## 📊 诊断结果

### 时间: 2026-04-11 17:05 UTC

---

## ✅ 已恢复工具

| 平台 | 工具 | 状态 | 测试结果 |
|------|------|------|----------|
| **B站** | bili-cli | ✅ 正常 | 热门视频获取成功 |
| **Twitter/X** | twitter-cli | ✅ 正常 | Feed 获取成功 |
| **LinkedIn** | LinkedIn CLI | ✅ 正常 | 个人资料获取成功 |
| **TikTok** | TiktokAutoUploader | ✅ 已配置 | Cookie 存在 |
| **Google** | gog CLI | ✅ 正常 | v0.12.0 |
| **V2EX** | 公开 API | ✅ 正常 | 无需认证 |
| **RSS** | 公开 API | ✅ 正常 | 无需认证 |

---

## ⚠️ 需要配置

| 平台 | 工具 | 问题 | 解决方案 |
|------|------|------|----------|
| **RedNote** | rednote-cli | 需要账号配置 | 运行 `rednote-cli account add` |
| **Reddit** | rdt-cli | Cookie 可能过期 | 更新 Cookie 文件 |
| **Instagram** | - | 未配置 | 使用 agent-browser |

---

## ❌ 放弃的方案

| 方案 | 原因 |
|------|------|
| **OpenCLI Browser Bridge** | Headless Chrome 不支持扩展 |
| **Agent Reach** | 用户要求放弃 |

---

## 🔧 工具路径

```bash
# 添加到 PATH
export PATH="$HOME/.local/bin:$PATH"

# 工具位置
~/.local/bin/bili          # B站
~/.local/bin/rednote-cli   # RedNote
~/.local/bin/twitter       # Twitter/X
~/.local/bin/rdt           # Reddit
~/.openclaw/tools/bin/linkedin-cli  # LinkedIn
~/.openclaw/tools/bin/gog  # Google Workspace
```

---

## 📋 Cookie 文件位置

```
~/.openclaw/data/
├── bilibili-cli/
│   └── credential.json    # B站 Cookie
├── rednote-cli/
│   └── cookies.json       # RedNote Cookie
├── linkedin/
│   └── cookies.json       # LinkedIn Cookie
├── twitter/
│   └── cookies.json       # Twitter Cookie
├── rdt-cli/
│   └── credential.json    # Reddit Cookie
└── tiktok/
    └── tiktok_session-*.cookie  # TikTok Cookie
```

---

## 🚀 快速测试命令

```bash
# B站
bili hot -n 5 --yaml

# Twitter/X
export TWITTER_AUTH_TOKEN="xxx"
export TWITTER_CT0="xxx"
twitter feed -n 5

# LinkedIn
linkedin-cli me

# V2EX
curl -s "https://www.v2ex.com/api/topics/hot.json" | python3 -m json.tool

# Google
gog gmail labels list
```

---

## 📝 下一步

1. **配置 RedNote 账号**: `rednote-cli account add`
2. **更新 Reddit Cookie**: 从浏览器获取新的 `reddit_session`
3. **测试 TikTok 上传**: 使用 TiktokAutoUploader

---

*生成时间: 2026-04-11 17:05 UTC*
