# Social Media Hub - API 凭证申请指南

## 平台申请流程

### 1. Instagram + Facebook (Graph API)

**步骤**：
1. 访问 [Meta for Developers](https://developers.facebook.com/)
2. 创建应用 → 选择"业务"类型
3. 添加产品：Facebook Login、Instagram Graph API
4. 创建 Facebook Page（如果没有）
5. 关联 Instagram Business 账号到 Page
6. 生成 Page Access Token
7. 申请权限：`pages_manage_posts`, `instagram_basic`, `instagram_content_publish`

**所需时间**：1-3 天审核

**凭证**：
- App ID
- App Secret
- Page Access Token
- Instagram Business Account ID

---

### 2. LinkedIn (Official API)

**步骤**：
1. 访问 [LinkedIn Developers](https://www.linkedin.com/developers/)
2. 创建应用
3. 请求 Marketing Developer Platform 访问权限
4. 配置 OAuth 2.0 重定向 URL
5. 生成 Access Token

**所需时间**：1-7 天审核

**凭证**：
- Client ID
- Client Secret
- Access Token

---

### 3. X / Twitter (API v2)

**步骤**：
1. 访问 [Twitter Developer Portal](https://developer.twitter.com/)
2. 申请开发者账号
3. 创建项目和应用
4. 申请 Basic 或 Pro 级别（Free 只能读）
5. 生成 API Key 和 Access Token

**所需时间**：即时 - 3 天

**凭证**：
- API Key
- API Secret
- Access Token
- Access Token Secret
- Bearer Token

**注意**：Free 层无法发帖，需要 Basic ($100/月) 或更高

---

### 4. Reddit (Official API)

**步骤**：
1. 访问 [Reddit Apps](https://www.reddit.com/prefs/apps)
2. 创建应用 → 选择"script"类型
3. 获取 Client ID 和 Secret

**所需时间**：即时

**凭证**：
- Client ID
- Client Secret
- User Agent

**注意**：免费，但有速率限制

---

### 5. 抖音 (开放平台)

**步骤**：
1. 访问 [抖音开放平台](https://developer.open-douyin.com/)
2. 注册开发者账号（需要企业资质）
3. 创建应用
4. 申请视频发布权限
5. 审核通过后获取凭证

**所需时间**：7-14 天

**凭证**：
- App ID
- App Secret

**注意**：需要企业认证

---

### 6. B站 (开放平台)

**步骤**：
1. 访问 [B站开放平台](https://openhome.bilibili.com/)
2. 申请开发者权限
3. 创建应用
4. 申请投稿接口权限

**所需时间**：3-7 天

**凭证**：
- Access Token
- App Key

---

### 7. 微博 (开放平台)

**步骤**：
1. 访问 [微博开放平台](https://open.weibo.com/)
2. 创建应用
3. 申请高级权限（发微博需要）
4. 审核通过后获取凭证

**所需时间**：3-7 天

**凭证**：
- App Key
- App Secret
- Access Token

---

### 8. 小红书 (无官方 API)

**方案**：
- 使用第三方服务（如小红书开放平台合作伙伴）
- 或使用自动化工具（风险较高）

**推荐**：暂时跳过，等待官方 API

---

## 凭证存储位置

所有凭证将安全存储在：
```
~/.openclaw/config/social-media-hub/
├── facebook.json      # Instagram + Facebook
├── linkedin.json
├── twitter.json
├── reddit.json
├── douyin.json
├── bilibili.json
└── weibo.json
```

---

## 下一步行动

1. **优先申请**：Reddit（最快，免费）
2. **其次申请**：X/Twitter（需要付费才能发帖）
3. **企业平台**：Meta (Instagram/Facebook)、LinkedIn
4. **国内平台**：抖音、B站、微博（需要企业资质）

---

**创建时间**: 2026-03-25
