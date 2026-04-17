# Social Media Hub 新方案设计

## 问题诊断

### 当前问题
1. **uv 工具丢失** - Pod 重启后 `/home/node/.local/share/uv/` 不存在
2. **Python 工具失效** - bili-cli, rednote-cli, twitter-cli, rdt-cli 都依赖 uv 的 Python 解释器
3. **Agent Reach 方案复杂** - 需要多个依赖，维护成本高

### 可用资源
- ✅ Chrome 147.0.7727.55
- ✅ XVFB 2:21.1.7-3
- ✅ Node.js v24.14.0
- ✅ Python 3.11.2
- ✅ gog CLI v0.12.0
- ✅ agent-browser 0.25.3
- ✅ LinkedIn CLI (bash 脚本)
- ✅ TiktokAutoUploader (已配置)

### Cookie 状态
- ✅ B站 Cookie 存在
- ✅ RedNote Cookie 存在
- ✅ LinkedIn Cookie 存在
- ✅ Twitter Cookie 存在
- ✅ Reddit Cookie 存在
- ✅ TikTok Cookie 存在

---

## 新方案：Chrome + XVFB + OpenCLI

### 架构

```
Social Media Hub
        │
        ├── OpenCLI (核心)
        │   ├── Chrome Extension (浏览器扩展)
        │   ├── CDP Bridge (Chrome DevTools Protocol)
        │   └── Headless Chrome + XVFB
        │
        ├── 独立工具
        │   ├── gog CLI (Google Workspace)
        │   ├── LinkedIn CLI (bash + curl)
        │   ├── TiktokAutoUploader (Python + Selenium)
        │   └── agent-browser (Playwright)
        │
        └── Cookie 管理
            └── ~/.openclaw/data/<platform>/
```

### 平台支持矩阵

| 平台 | 方案 | 功能 | 状态 |
|------|------|------|------|
| **B站** | OpenCLI Extension | 热门、搜索、发帖 | 需配置 |
| **RedNote** | OpenCLI Extension | 热门、搜索、发帖 | 需配置 |
| **LinkedIn** | LinkedIn CLI | 个人资料、搜索 | ✅ 可用 |
| **Twitter/X** | OpenCLI Extension | 时间线、发帖、搜索 | 需配置 |
| **Reddit** | OpenCLI Extension | 热门、搜索、发帖 | 需配置 |
| **TikTok** | TiktokAutoUploader | 上传视频 | ✅ 可用 |
| **Instagram** | OpenCLI Extension | Feed、发帖 | 需配置 |
| **V2EX** | 公开 API | 热门、主题 | ✅ 可用 |
| **RSS** | 公开 API | 订阅源 | ✅ 可用 |

---

## 实施步骤

### Phase 1: 安装 OpenCLI

```bash
# 安装 OpenCLI
npm install -g @jackwener/opencli

# 安装 Chrome Extension
# 用户需要在本地浏览器安装 OpenCLI Extension

# 配置 CDP Bridge
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9224"
```

### Phase 2: 配置 XVFB + Chrome

```bash
# 启动 XVFB
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99

# 启动 Chrome (带扩展)
google-chrome \
  --remote-debugging-port=9224 \
  --user-data-dir=/tmp/chrome-profile \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-default-apps \
  --disable-extensions-except=/path/to/opencli-extension \
  --load-extension=/path/to/opencli-extension \
  about:blank
```

### Phase 3: 配置 OpenCLI 平台

```bash
# 登录各平台
opencli bilibili login
opencli xiaohongshu login
opencli twitter login
opencli reddit login
opencli instagram login
```

### Phase 4: 测试功能

```bash
# 测试各平台
opencli bilibili hot --limit 5
opencli xiaohongshu feed --limit 5
opencli twitter timeline --limit 5
opencli reddit hot --limit 5
```

---

## 替代方案：直接使用 Chrome Extension

如果 OpenCLI 配置复杂，可以直接使用 Chrome Extension：

### 方案 A: OpenCLI Browser Extension

1. 用户在本地浏览器安装 OpenCLI Extension
2. Extension 与 OpenCLI Daemon 通信
3. 通过 Extension API 访问各平台

### 方案 B: Playwright + agent-browser

```bash
# 使用 agent-browser (已安装)
agent-browser navigate "https://www.bilibili.com"
agent-browser screenshot /tmp/bilibili.png
```

### 方案 C: 直接 API 调用

使用各平台的公开 API 或 Cookie 认证：

- **B站**: Cookie + API
- **RedNote**: Cookie + API
- **LinkedIn**: Cookie + API (已实现)
- **Twitter**: Cookie + API
- **Reddit**: Cookie + API
- **TikTok**: TiktokAutoUploader (已实现)

---

## 推荐方案

### 短期方案（立即可用）

1. **LinkedIn**: 使用现有 LinkedIn CLI ✅
2. **TikTok**: 使用 TiktokAutoUploader ✅
3. **V2EX/RSS**: 使用公开 API ✅
4. **Google Workspace**: 使用 gog CLI ✅

### 中期方案（需要配置）

1. **安装 OpenCLI** 并配置 CDP Bridge
2. **使用 agent-browser** 进行浏览器自动化
3. **重新安装 uv 工具** 恢复 Python CLI 工具

### 长期方案（稳定架构）

1. **OpenCLI + Chrome Extension** 作为核心
2. **独立工具** 作为补充
3. **统一 Cookie 管理**

---

## 下一步行动

1. [ ] 安装 OpenCLI
2. [ ] 配置 XVFB + Chrome
3. [ ] 测试 OpenCLI 平台
4. [ ] 重新安装 uv 工具
5. [ ] 恢复 Python CLI 工具
6. [ ] 更新 HEARTBEAT.md

---

*创建时间: 2026-04-11 16:45 UTC*
