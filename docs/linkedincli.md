# LinkedIn — linkedincli

## 概览

| 项目 | 值 |
|------|-----|
| **工具** | @bcharleson/linkedincli |
| **版本** | 0.1.5 |
| **GitHub** | https://github.com/bcharleson/linkedincli |
| **安装方式** | `npm install --prefix ~/.openclaw/tools/npm -g @bcharleson/linkedincli` |
| **可执行路径** | `~/.openclaw/tools/npm/bin/linkedin` → `~/.openclaw/tools/bin/linkedin` (symlink) |
| **命令** | `linkedin` |
| **认证** | Cookie session (`li_at` + `JSESSIONID`) |
| **底层** | LinkedIn Voyager API |
| **账号** | Kui XU (Digital Media) |

## 安装 & 持久化

```bash
# 安装到用户目录
mkdir -p ~/.openclaw/tools/npm
npm install --prefix ~/.openclaw/tools/npm -g @bcharleson/linkedincli

# 快捷命令 symlink
ln -sf ~/.openclaw/tools/npm/bin/linkedin ~/.openclaw/tools/bin/linkedin
```

### 配置文件

- **位置**: `~/.linkedin-cli/config.json`
- **格式**: `{"li_at": "...", "jsessionid": "..."}`
- **认证优先级**: `--li-at`/`--jsessionid` flags → `LINKEDIN_LI_AT`/`LINKEDIN_JSESSIONID` env vars → config file

### Pod 重启后恢复

```bash
export PATH="$HOME/.openclaw/tools/bin:$HOME/.local/bin:$PATH"
# 运行凭证刷新脚本
linkedin-cli-refresh
```

## 认证

### Cookie 来源

从 Chrome CDP 自动提取 `li_at` 和 `JSESSIONID`：

```bash
# 自动刷新凭证
linkedin-cli-refresh
```

脚本流程：
1. Chrome CDP `Network.getCookies` 提取 LinkedIn cookies
2. 写入 `~/.linkedin-cli/config.json`
3. 运行 `linkedin profile me` 验证

### Cookie 过期

- `li_at` 通常几周过期
- 过期时 CLI 返回 `AUTH_ERROR`
- 运行 `linkedin-cli-refresh` 刷新
- 如果刷新失败（Chrome 也过期），需要重新登录 LinkedIn

## 命令参考（43 个）

### 发帖

```bash
# 文字帖
linkedin posts create --text "Hello LinkedIn!"

# 图片帖
linkedin posts create --text "With image" --image ./pic.jpg

# 仅联系人可见
linkedin posts create --text "Inner circle" --visibility connections

# 编辑帖子
linkedin posts edit <share-urn> --text "Updated text"

# 删除帖子
linkedin posts delete <share-urn>
```

### 快捷命令（推荐）

```bash
# 发帖（自动从 CDP 提取 Cookie）
linkedin-cli-post --text "Post content"
linkedin-cli-post --text "With image" --image /path/to/image.jpg
```

### 互动

```bash
linkedin engage react <post-urn> --type LIKE       # 点赞
linkedin engage react <post-urn> --type PRAISE     # 庆祝
linkedin engage react <post-urn> --type EMPATHY    # 关爱
linkedin engage react <post-urn> --type INTEREST   # 有见地
linkedin engage comment <post-urn> --text "Great!" # 评论
linkedin engage share <share-urn> --text "Worth reading"  # 转发
```

### Profile

```bash
linkedin profile me                              # 自己的资料
linkedin profile view <public-id>                # 他人资料
linkedin profile contact-info <public-id>        # 联系方式
linkedin profile skills <public-id>              # 技能
linkedin profile network <public-id>             # 人脉
linkedin profile posts <urn-id>                  # 最近帖子
```

### Feed

```bash
linkedin feed view                               # 自己的 Feed
linkedin feed view --count 50                    # 更多
linkedin feed user <profile-id>                  # 他人的动态
linkedin feed company <company-name>             # 公司动态
```

### 消息

```bash
linkedin messaging conversations                 # 所有对话
linkedin messaging messages <conversation-id>    # 读取消息
linkedin messaging send <conversation-id> -t "Hi!"  # 回复
linkedin messaging send-new -r <urn> -t "Hello!"    # 新对话
```

### 搜索

```bash
linkedin search people --keywords "software engineer"
linkedin search people --keywords "CTO" --network F   # 一度人脉
linkedin search companies --keywords "AI startups"
linkedin search jobs --keywords "engineer" --remote
linkedin search posts --keywords "AI trends"
```

### 连接

```bash
linkedin connections send <profile-urn>           # 发送连接请求
linkedin connections received                     # 待处理请求
linkedin connections accept <id> --secret <s>     # 接受
```

### 分析

```bash
linkedin analytics profile-views                 # 谁看了我的主页
```

## 输出格式

所有命令支持：

- `--pretty` — 格式化 JSON
- `--quiet` — 静默模式
- `--fields <list>` — 只返回指定字段

## 与旧方案对比

| 维度 | 旧方案 (linkedin-post.js) | 新方案 (linkedincli) |
|------|---------------------------|---------------------|
| 发帖 | CDP DOM 操作 Shadow DOM | `linkedin posts create` |
| 图片帖 | CDP setFileInputFiles | `--image` 参数 |
| 速度 | 慢（需导航+等待DOM） | 快（直接 API） |
| 稳定性 | Shadow DOM 变化会 break | Voyager API 相对稳定 |
| 功能 | 只有发帖 | 43 个命令全覆盖 |
| 依赖 | 常驻 Chrome + CDP | 只需 Node.js + Cookie |

## ⚠️ 注意事项

1. **Voyager API 风险** — LinkedIn 内部 API，可能随时变化
2. **Cookie 过期** — `li_at` 通常几周过期，需定期刷新
3. **版本 0.1.5** — 早期版本，可能有 bug
4. **ToS 风险** — 自动化操作可能违反 LinkedIn 服务条款（与浏览器方案风险相当）
5. **旧脚本保留** — `linkedin-post.js` 作为 fallback 保留

---

*最后更新: 2026-04-14*
