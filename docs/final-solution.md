# Social Media Hub 最终方案

## 问题总结

### OpenCLI 限制
- **Browser Bridge Extension** 需要 Chrome 扩展
- **Headless Chrome** 不支持扩展
- **非 Headless Chrome** 在容器中不稳定（缺少 dbus）

### 结论
**放弃 OpenCLI Browser Bridge 方案**

---

## 最终方案：混合架构

### 方案 A: 重新安装 uv + Python CLI 工具

**优点：**
- 恢复原有工具
- 稳定可靠
- 已有 Cookie 配置

**步骤：**
```bash
# 安装 uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 安装工具
uv tool install bilibili-cli
uv tool install rednote-cli
uv tool install twitter-cli
uv tool install rdt-cli
```

### 方案 B: agent-browser (Playwright)

**优点：**
- 已安装
- 支持 headless
- 可截图、自动化

**使用：**
```bash
agent-browser navigate "https://www.bilibili.com"
agent-browser screenshot /tmp/bilibili.png
```

### 方案 C: 直接 API 调用

**优点：**
- 不需要浏览器
- 稳定快速
- Cookie 认证

**已实现：**
- LinkedIn CLI (bash + curl) ✅
- TiktokAutoUploader (Python) ✅
- gog CLI (Google Workspace) ✅

---

## 推荐方案

### 立即可用（无需配置）

| 平台 | 工具 | 状态 |
|------|------|------|
| LinkedIn | LinkedIn CLI | ✅ |
| TikTok | TiktokAutoUploader | ✅ |
| Google | gog CLI | ✅ |
| V2EX | 公开 API | ✅ |
| RSS | 公开 API | ✅ |

### 需要恢复（重新安装 uv）

| 平台 | 工具 | 状态 |
|------|------|------|
| B站 | bili-cli | ⚠️ 需重装 |
| RedNote | rednote-cli | ⚠️ 需重装 |
| Twitter | twitter-cli | ⚠️ 需重装 |
| Reddit | rdt-cli | ⚠️ 需重装 |

### 可选方案

| 平台 | 工具 | 状态 |
|------|------|------|
| Instagram | agent-browser | ⚠️ 需配置 |
| TikTok (读取) | tiktokdl | ⚠️ 需重装 |

---

## 实施步骤

### Step 1: 安装 uv

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
```

### Step 2: 安装 Python CLI 工具

```bash
uv tool install bilibili-cli
uv tool install rednote-cli
uv tool install twitter-cli
uv tool install rdt-cli
```

### Step 3: 恢复 Cookie 配置

Cookie 文件已保存在 `~/.openclaw/data/`，工具安装后自动生效。

### Step 4: 验证

```bash
bili hot -n 1 --yaml
rednote hot --yaml
twitter feed -n 5
rdt popular -n 3 --yaml
```

---

## 更新 HEARTBEAT.md

```markdown
## 登录保活（每日执行）

### 立即可用
- [x] LinkedIn: `linkedin-cli me`
- [x] TikTok: `tiktokdl trending` (如已安装)
- [x] V2EX: `curl -s "https://www.v2ex.com/api/topics/hot.json"`
- [x] Google: `gog gmail labels list`

### 需要恢复（安装 uv 后）
- [ ] B站: `bili hot -n 1 --yaml`
- [ ] RedNote: `rednote hot --yaml`
- [ ] Twitter/X: `twitter feed -n 5`
- [ ] Reddit: `rdt popular -n 3 --yaml`
```

---

*更新时间: 2026-04-11 17:00 UTC*
