# dsh-tenant-switcher

> 自建过 AI bot？把你那套 Markdown 记忆（SOUL / index / log）原样挂进 DSH：一个目录一个租户，不复制、不搬家、不改格式。

租户 = Agent 预设（`agentPresets`）。这个 bundle 做三件事：

1. **注册**：读 `~/.dsh/tenants/<id>/tenant.json`，每个目录注册一个预设 `tenant-<id>`；
2. **注入**：预设挂上本包，在自己的 scope 里把该租户的 `persona.md` 和记忆摘要（`memory/SOUL.md`、`memory/index.md`）加进 system prompt；
3. **显示**：对话框工具行左侧一个 chip，告诉你这个会话是谁、目录里有哪些租户、每个是不是活得起来。

它不建记忆、不写记忆、不做跨租户通信——那几块还没写，README 里也不假装有。

## 装

```powershell
# 在 DSH 里（Plugins 页面「添加插件」选这个目录，或让 agent 用 plugin_manager install_bundle）
<克隆/解压后的目录>\dsh-tenant-switcher
```

装完**重启一次 DSH**。bundle 的插件行是启动时装载的：不重启，Host 半的路由不存在
（`GET /dsh-tenant-switcher/presets` → 404），页面缓存里也没有这个 Client 插件。
Ctrl+R / F5 在这个窗口里不管用，得真的重启。

重启后**对话框工具行左侧**（记忆开关 chip 的右边）会多出一个「租户」chip，
样式、字号、菜单几何都照 `dsh-plugin-memory` 的 `memory-session-toggle`。

## 加一个租户

1. 点 chip → 点「＋ 添加新租户」→ 面板显示 `tenant.json` 模板，点「复制」；
2. 建目录 `~/.dsh/tenants/<租户id>/`，把模板存成 `tenant.json`，改 `id`（或删掉这一行，以目录名为准）、`name`、`description`；
3. 在同一目录放 `persona.md` 和（可选）`memory/SOUL.md`、`memory/index.md`；
4. 重启 DSH。预设 `tenant-<租户id>` 出现在官方的模式下拉里，用它开的新会话就是这个租户。

菜单里的「租户目录」一栏会列出所有目录和状态：

| 状态 | 意思 |
| --- | --- |
| 已生效 | 预设注册了，插件也真的挂上了，人格和记忆在 prompt 里 |
| 已注册 | 预设注册了，但这个预设还没被任何会话用过（插件实例没起） |
| 等重启 | 目录里读到了，但这次启动时还不在——重启后注册 |
| 装不起来 | `tenant.json` 坏了、id 不合法或和目录名不一致；下面一行写原因 |

`GET /dsh-tenant-switcher/tenants` 是同一份数据的原始 JSON，排查时直接看它。

## 用现成的记忆库（不搬家）

`persona`、`memoryDir`、`workspaceDir` 可以是**绝对路径**。绝对路径原样使用，相对路径按租户目录解析——所以一个租户可以直接挂上已经存在的记忆库：

```json
{
  "id": "sample",
  "name": "示例",
  "persona": "persona.md",
  "memoryDir": "C:/Users/<you>/.memory",
  "memory": { "schema": "soul-index-log", "readOnly": true }
}
```

此时 persona 还在租户目录里，`SOUL.md` / `index.md` 从 `.memory` 读。现在只读：**写回还没接**，所以别指望在这个租户里改记忆会存下来。

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

然后重启。`tenant-sample`、`tenant-empty` 出现在模式下拉里。


## 为什么没有「切换」

宿主注册表在会话跑过第一轮之后拒绝换预设（抛 `agent-preset/locked`），所以租户只能在开会话时绑。
这个界面不假装能切：脚注写的就是这句。选预设交给官方的模式下拉，chip 不重复一份。

## 列表从哪来

Host 半的三条只读路由（都只收 GET/HEAD）：

| 路由 | 内容 |
| --- | --- |
| `GET /dsh-tenant-switcher/presets` | 内部调 `ctx.agentPresets.list()` 的预设名单，用来把 id 翻成名字 |
| `GET /dsh-tenant-switcher/tenant-template` | 随包的 `templates/tenant.json` |
| `GET /dsh-tenant-switcher/tenants` | 租户目录的扫描结果与注册状态 |

不走 Client 的 Remote 门面，因为 `@deepseek-ai/dsh-api-remotes` 的命名空间清单是构建时固定的，
`agentPresets` 不在其中，客户端也没有运行时发现能力。

## 测试

纯 node，不需要宿主：

```powershell
node test/tenants.test.js   # 目录发现、校验、注入材料的读取
node test/index.test.js     # 用假 Cordis ctx 跑 apply()：注册、诊断路由、只读、模板路由
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
| `index.js` | Host 半：租户发现 + 预设注册 + 三条只读路由 + 租户内注入 |
| `tenants.js` | 不依赖宿主的那一半：读目录、校验、拼预设定义（可单测） |
| `client.js` | 浏览器半：`conversation.input.left` 的 chip、向上弹的菜单、样式、文案 |
| `cordis.patch.yml` | 插入插件行 |
| `locale/*.json` | Plugins 页的标题/描述/详情路径 |
| `docs/DETAIL.md` | 详情文档（含踩过的坑） |
| `templates/tenant.json` | 租户描述文件模板 |
| `examples/` | 两个可抄的租户：读外部记忆库的、空的 |
| `test/*.test.js` | 离线测试 |
| `icon.svg` | 图标 |

## 许可

MIT，见 [LICENSE](LICENSE)。
