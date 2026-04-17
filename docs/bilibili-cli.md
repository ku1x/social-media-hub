# B站 (Bilibili) — bili-cli

## 概览

| 项目 | 值 |
|------|-----|
| **工具** | bilibili-cli (bili) |
| **版本** | 0.6.2 |
| **GitHub** | https://github.com/public-clis/bilibili-cli |
| **安装方式** | `uv tool install bilibili-cli` |
| **可执行路径** | `~/.local/bin/bili` → `~/.openclaw/tools/bin/bili` (symlink) |
| **账号** | Quark97 (UID: 46139578, LV6) |
| **认证状态** | ✅ 已登录（凭证 7天+，浏览器刷新失败但凭证仍有效） |

## 安装 & 持久化

```bash
# 安装
~/.openclaw/tools/uv/uv tool install bilibili-cli

# 快捷命令 symlink
ln -sf ~/.local/bin/bili ~/.openclaw/tools/bin/bili

# 凭证持久化 — symlink 到 PVC 路径
mkdir -p ~/.openclaw/data/bilibili-cli
mkdir -p ~/.bilibili-cli
ln -sf ~/.openclaw/data/bilibili-cli/credential.json ~/.bilibili-cli/credential.json
```

### 凭证文件

- **持久化位置**: `~/.openclaw/data/bilibili-cli/credential.json` (PVC)
- **运行时位置**: `~/.bilibili-cli/credential.json` → symlink 到持久化路径
- **必需字段**: `sessdata`, `bili_jct`, `dedeuserid`
- **写入操作** 需要 `bili_jct`

### Pod 重启后恢复

```bash
# 1. 确保 PATH 包含工具目录
export PATH="$HOME/.openclaw/tools/bin:$HOME/.local/bin:$PATH"

# 2. 重建 symlink
mkdir -p ~/.bilibili-cli
ln -sf ~/.openclaw/data/bilibili-cli/credential.json ~/.bilibili-cli/credential.json

# 3. 验证
bili status
```

## 认证

### 3 层认证策略

1. **已保存凭证** — 从 `~/.bilibili-cli/credential.json` 加载
2. **浏览器 Cookie** — 自动从 Chrome/Firefox 提取（headless 环境不可用）
3. **扫码登录** — `bili login` 显示终端二维码

### 扫码登录

```bash
bili login
```

在 headless 环境中，需要截图二维码上传给用户扫描。

### 检查登录状态

```bash
bili status          # 人类可读
bili status --yaml   # 结构化输出
bili whoami          # 详细资料（等级、硬币、粉丝）
bili whoami --yaml   # 结构化输出
```

## 命令参考

### 视频浏览

```bash
bili video BV1ABcsztEcY                    # 视频详情
bili video BV1ABcsztEcY --subtitle         # 带字幕（纯文本）
bili video BV1ABcsztEcY --subtitle-timeline # 带时间线
bili video BV1ABcsztEcY -st --subtitle-format srt  # 导出 SRT
bili video BV1ABcsztEcY --ai               # AI 摘要
bili video BV1ABcsztEcY --comments         # 热门评论
bili video BV1ABcsztEcY --related          # 相关视频
bili video BV1ABcsztEcY --yaml             # Agent 友好 YAML
bili video BV1ABcsztEcY --json             # 标准化 JSON
```

### 用户

```bash
bili user 946974                           # UP 主资料
bili user "影视飓风"                        # 按名称搜索
bili user-videos 946974 --max 20           # 视频列表
```

### 发现

```bash
bili hot                                   # 热门视频
bili hot --page 2 --max 10                 # 第2页，前10
bili rank                                  # 全站排行（3天）
bili rank --day 7 --max 30                 # 7天排行，前30
bili search "关键词"                        # 搜索用户
bili search "关键词" --type video --max 5   # 搜索视频
bili feed                                  # 动态时间线
bili feed --offset 1234567890              # 下一页
```

### 动态

```bash
bili my-dynamics                           # 我的动态
bili dynamic-post "发布内容"                # 发布文字动态
bili dynamic-delete 123456789012345678     # 删除动态
```

### 收藏 & 关注

```bash
bili favorites                             # 收藏夹列表
bili favorites <ID> --page 2              # 收藏夹内容
bili following                             # 关注列表
bili watch-later                           # 稍后再看
bili history                               # 观看历史
```

### 互动

```bash
bili like BV1ABcsztEcY                     # 点赞
bili coin BV1ABcsztEcY                     # 投币
bili triple BV1ABcsztEcY                   # 一键三连 🎉
bili unfollow 946974                       # 取消关注
```

### 音频提取

```bash
bili audio BV1ABcsztEcY                    # 下载+切分 25s WAV
bili audio BV1ABcsztEcY --segment 60       # 60s 每段
bili audio BV1ABcsztEcY --no-split         # 完整 m4a
bili audio BV1ABcsztEcY -o ~/data/         # 自定义输出目录
```

需要额外安装: `uv tool install "bilibili-cli[audio]"`

## 输出格式

所有 `--json` / `--yaml` 输出使用标准 envelope：

```json
{
  "ok": true,
  "schema_version": "1",
  "data": { ... },
  "error": null
}
```

- **Agent 场景**优先用 `--yaml`（更省 token）
- **jq/脚本**场景用 `--json`
- **非 TTY** stdout 自动默认 YAML
- 可用 `OUTPUT=yaml|json|rich|auto` 环境变量覆盖

## 保活

B站保活通过 Chrome CDP 导航实现（`keepalive.sh bilibili`），不依赖 bili-cli。

但也可以用 bili-cli 验证登录状态：
```bash
bili status --yaml
```

## ⚠️ 注意事项

1. **凭证有效期** — 当前凭证已 7天+，浏览器刷新在 headless 环境失败，需定期用 `bili login` 刷新
2. **写入操作** — like/coin/triple/dynamic-post 需要 `bili_jct`，确保凭证文件包含此字段
3. **Headless 限制** — 浏览器 Cookie 自动提取不可用，只能用扫码登录或手动配置
4. **音频功能** — 需要额外安装 `[audio]` 依赖组

---

*最后更新: 2026-04-13*
