# dsh-tenant-switcher

> 自建过 AI bot？把你那套 Markdown 记忆（SOUL / index / log）原样挂进 DSH：一个目录一个租户，不复制、不搬家、不改格式。

**租户 = 一个工作区。** 不是预设、不是账号、不是 profile。这个 bundle 做三件事：

1. **落地**：读 `~/.dsh/tenants/<id>/tenant.json`，确保该租户的 `workspace/` 目录存在；
2. **注入**：会话的工作目录落在哪个租户的工作区里，就只给那个会话加人格（`persona.md`）和记忆（`memory/SOUL.md`、`memory/index.md`）；不吃这里记忆的租户，顺手把 `dsh-plugin-memory` 的全局记忆库在这个会话里关掉；
3. **显示与选择**：对话框工具行左侧一个 chip —— 当前会话属于哪个租户、目录里有哪些租户，点一个就在它的工作区里开新会话。

官方模式（标准 / PTC / 极简 / 创造）一个都不动：租户和模式是两个轴，互不占位。它不建记忆、不写记忆、不做跨租户通信——那几块还没写，README 里也不假装有。

## 装

```powershell
# 在 DSH 里（Plugins 页面「添加插件」选这个目录，或让 agent 用 plugin_manager install_bundle）
<克隆/解压后的目录>\dsh-tenant-switcher
```

装完**重启一次 DSH**。bundle 的插件行是启动时装载的：不重启，Host 半的路由不存在，页面缓存里也没有这个 Client 插件。Ctrl+R / F5 在这个窗口里不管用，得真的重启。

重启后**对话框工具行左侧**（记忆开关 chip 的右边）会多出一个「租户」chip，样式、字号、菜单几何都照 `dsh-plugin-memory` 的 `memory-session-toggle`。

## 加一个租户

1. 点 chip → 点「＋ 添加新租户」→ 面板显示 `tenant.json` 模板，点「复制」；
2. 建目录 `~/.dsh/tenants/<租户id>/`，把模板存成 `tenant.json`，改 `id`（或删掉这一行，以目录名为准）、`name`、`description`；
3. 在同一目录放 `persona.md` 和（可选）`memory/SOUL.md`、`memory/index.md`；
4. 重启 DSH。菜单里出现这个租户，点一下就从它的工作区开新会话。

菜单里的「租户目录」一栏会列出所有目录和状态：

| 状态 | 意思 |
| --- | --- |
| 可开 | 工作区目录在，点一下就能开 |
| 工作区待建 | 描述读到了，但工作区目录还没建出来（下次启动会建） |
| 装不起来 | `tenant.json` 坏了、id 不合法或和目录名不一致；下面一行写原因 |

`GET /dsh-tenant-switcher/tenants` 是同一份数据的原始 JSON；带上 `?sessionId=<会话id>` 时多回一个 `current`，就是「这个会话归哪个租户」。

## 记忆怎么隔离

`dsh-plugin-memory` 是**根作用域单例**：它对每个 agent 都注入全局记忆库，只看会话自己的开关。所以「租户记忆不互通」不能靠叠加，只能：
- 租户自己的记忆由本插件注入（`persona.md` + `memory/SOUL.md` + `memory/index.md`）；
- 不继承全局记忆库的租户（`inheritGlobalMemory: false`），本插件在 `agent/created` 时调 `dsh-plugin-memory` 自己的 `/api/memory/session`，把那个会话的记忆关掉——**走它的路由，不绕过去改它的文件**（`memory-sessions.json` 只在启动时读一次，改文件是自欺）。

```json
{ "inheritGlobalMemory": false }
```

`true` 表示这个租户本来就用全局那一套（比如你的主记忆库）：此时本插件只加人格，不再重复注入 SOUL/index。

## 用现成的记忆库（不搬家）

`persona`、`memoryDir`、`workspaceDir` 可以是**绝对路径**。绝对路径原样使用，相对路径按租户目录解析——所以一个租户可以直接挂上已经存在的记忆库：

```json
{
  "id": "sample",
  "name": "示例",
  "persona": "persona.md",
  "memoryDir": "C:/Users/<you>/.memory",
  "workspaceDir": "workspace",
  "inheritGlobalMemory": false,
  "memory": { "schema": "soul-index-log", "readOnly": true }
}
```

`examples/` 里有两个可以直接抄的：

| 目录 | 是什么 |
| --- | --- |
| `examples/sample/` | 读外部记忆库的那种：`memoryDir` 指向 `.memory`，`persona.md` 是人格 |
| `examples/empty/` | 空示例：只有 id 和名字，什么都不注入，用来对照 |

```powershell
# 复制到真正的位置（目录在工作区外，需要写权限）
Copy-Item -Recurse examples\sample $env:USERPROFILE\.dsh\tenants
Copy-Item -Recurse examples\empty $env:USERPROFILE\.dsh\tenants
```

然后重启。

## 为什么没有「切换到别的租户」

一个会话的工作目录是它的创建事实，中途换目录等于换会话。所以这里的动作是「在租户 X 的工作区里开一个新会话」，不是切换。
同理，跑过一轮的会话不能换预设（宿主抛 `agent-preset/locked`）——但那是模式的事，和租户无关了。

## 列表从哪来

Host 半的三条只读路由（都只收 GET/HEAD）：

| 路由 | 内容 |
| --- | --- |
| `GET /dsh-tenant-switcher/tenants` | 租户目录扫描结果 + 工作区路径 + 文件齐不齐 +（可选）会话归属 |
| `GET /dsh-tenant-switcher/tenant-template` | 随包的 `templates/tenant.json` |
| `GET /dsh-tenant-switcher/presets` | 旧的预设名单，留着给 0.3 那版装过的机器排错 |

不走 Client 的 Remote 门面，因为 `@deepseek-ai/dsh-api-remotes` 的命名空间清单是构建时固定的，`agentPresets` 不在其中，客户端也没有运行时发现能力。

## 测试

纯 node，不需要宿主：

```powershell
node test/tenants.test.js   # 目录发现、校验、路径解析、工作区归属匹配
node test/index.test.js     # 用假 Cordis ctx 跑 apply()：按 cwd 绑定、注入、记忆开关、只读、模板路由
```

`node --test test/` 在这套沙箱里会 `spawn EPERM`（子进程被拦），直接 `node test/<file>` 即可。

## 还没做的

- 记忆**写回**：现在只读 `SOUL.md` / `index.md`，改了会丢；
- `tools` / `model` / `sandbox` / `mailbox` 四个字段只被读进记录，没有代码执行它们；
- 跨租户信箱；
- 改完 `tenant.json` 不用重启（现在要）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：租户发现、建工作区、按会话 cwd 绑定并注入、记忆开关、三条只读路由 |
| `tenants.js` | 不依赖宿主的那一半：读目录、校验、路径解析、工作区归属匹配（可单测） |
| `client.js` | 浏览器半：`conversation.input.left` 的 chip、向上弹的菜单、可点的租户行、文案 |
| `cordis.patch.yml` | 插入插件行 |
| `locale/*.json` | Plugins 页的标题/描述/详情路径 |
| `docs/DETAIL.md` | 详情文档（含踩过的坑） |
| `templates/tenant.json` | 租户描述文件模板 |
| `examples/` | 两个可抄的租户：读外部记忆库的、空的 |
| `test/*.test.js` | 离线测试 |
| `icon.svg` | 图标 |

## 许可

MIT，见 [LICENSE](LICENSE)。
