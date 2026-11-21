# dsh-tenant-switcher

租户切换器的**界面层**。租户 = Agent 预设（`agentPresets`），这个 bundle 不建租户、不碰记忆，
只做两件事：告诉你这个会话是谁，以及以别人开一个新会话。

## 装

```powershell
# 在 DSH 里（Plugins 页面「添加插件」选这个目录，或让 agent 用 plugin_manager install_bundle）
<克隆/解压后的目录>\dsh-tenant-switcher
```

装完**重启一次 DSH**。bundle 的插件行是启动时装载的：不重启，Host 半的路由不存在
（`GET /dsh-tenant-switcher/presets` → 404），页面缓存里也没有这个 Client 插件。
Ctrl+R / F5 在这个窗口里不管用，得真的重启。

重启后**对话框工具行左侧**（记忆开关 chip 的右边）会多出一个「租户」chip，
样式、字号、菜单几何都照 `dsh-plugin-memory` 的 `memory-session-toggle`：

- chip 上显示这个会话的租户名（没绑定时显示「租户」）；
- 点开是向上弹的面板：第一行是当前租户，下面一个「＋ 添加新租户」。

## 用

点 chip → 看当前是谁 → 点「添加新租户」→ 面板变成 `tenant.json` 模板，复制出来
放到 `~/.dsh/tenants/<租户id>/tenant.json`。

选预设这件事交给官方的模式下拉：它已经做了同一件事，这个 chip 不再重复一份。

## 为什么没有「切换」

宿主注册表在会话跑过第一轮之后拒绝换预设（抛 `agent-preset/locked`），所以租户只能开会话时绑。
这个界面不假装能切：脚注写的就是这句。

## 列表从哪来

自己 Host 半的一条只读路由 `GET /dsh-tenant-switcher/presets`，内部调 `ctx.agentPresets.list()`。
不走 Client 的 Remote 门面，因为 `@deepseek-ai/dsh-api-remotes` 的命名空间清单是构建时固定的，
`agentPresets` 不在其中，客户端也没有运行时发现能力。

## 第一版的三处未验证点

见 `docs/DETAIL.md` 末节。都收在 `client.js` 的几行里。

## 租户描述文件（还没接上）

`templates/tenant.json` 是 `~/.dsh/tenants/<id>/tenant.json` 的格式模板。**现在没有任何代码读它**，
复制过去也不会生效——把租户读成预设的注册器还没写。它在这里的作用只有一个：先把字段名定下来。

真正接上要三步：目录里放 `tenant.json` → Host 读目录并 `ctx.agentPresets.register(...)`
→ 每个租户的 preset 里挂一行 `dsh-tenant-agent`，由它在自己的 scope 内注入人格和记忆。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：`GET /dsh-tenant-switcher/presets` 返回预设名单 |
| `client.js` | 浏览器半：`conversation.input.left` 的 chip、向上弹的菜单、样式、文案 |
| `cordis.patch.yml` | 插入插件行 |
| `locale/*.json` | Plugins 页的标题/描述/详情路径 |
| `docs/DETAIL.md` | 详情文档 |
| `templates/tenant.json` | 租户描述文件模板（目前只是格式占位，没有代码读它） |
| `icon.svg` | 图标 |

## 许可

MIT，见 [LICENSE](LICENSE)。
