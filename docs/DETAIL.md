# 租户切换器

给「租户 = Agent 预设」这件事一个能跑起来的实现：**读目录、注册预设、注入人格与记忆摘要**，外加一个能看见状态的界面。

## 它做什么

**宿主半（`index.js` + `tenants.js`）**

- **扫目录**：每次启动读 `~/.dsh/tenants/*/`，目录名就是租户 id（小写字母/数字/`-`/`_`，1–48 位），`tenant.json` 描述它。
- **注册预设**：每个租户注册一个 `{ id: 'tenant-<id>', name, description, order, plugins: [本包 + config { tenant, tenantDir }] }`。于是它出现在官方模式下拉里。
- **坏租户不消失**：JSON 坏、id 不合法、`id` 和目录名不一致，都会被列成一条带原因的 `error` 行，并 `logger.warn` 一次。不静默跳过。
- **租户内注入**：预设实例（`config.tenant` 非空）在**自己的 scope 里**把 `persona.md` 作为 `systemPrompt.section`、把 `memory/SOUL.md` + `memory/index.md` 作为 `systemPrompt.context`（order 300 / 310）加进去。注入材料在装载时读一次，缺文件就是空串，不致命。

**浏览器半（`client.js`）**

- chip 挂在 `conversation.input.left`（输入框工具行左侧、记忆开关 chip 右边），样式、字号（13px chip / 12px 菜单项）、菜单几何（向上弹、8px 圆角）都照 `dsh-plugin-memory` 的 `memory-session-toggle`。
- chip 上写当前租户（读会话投影 `agentPreset`，用 roster 路由把 id 翻成名字）；没绑定写「租户」。
- 面板：当前租户一行 → 租户目录列表（每条带状态点与状态字，坏的那行下面跟原因）→ 「＋ 添加新租户」→ 模板视图（原文 + 复制 + 存到哪 + 要重启）。

## 它不做什么

- **不选预设**。官方模式下拉在做同一件事，chip 不重复一份入口。
- **不做「切换」**。注册表在会话跑过第一轮之后让 `select()` 抛 `agent-preset/locked`，租户只能开会话时绑。
- **不写记忆**。现在只读 `SOUL.md` / `index.md`，改了会丢；写入这条路没接。
- **不执行 `tools` / `model` / `sandbox` / `mailbox`**。这四个字段被读进记录，没有代码用它们。
- 不替换新会话页原生的预设控件（`conversation.hero.agentPreset`）。

## 三条只读路由

| 路由 | 内容 |
| --- | --- |
| `GET /dsh-tenant-switcher/presets` | `ctx.agentPresets.list()` 的名单，给 chip 翻名字用 |
| `GET /dsh-tenant-switcher/tenant-template` | 随包的 `templates/tenant.json` |
| `GET /dsh-tenant-switcher/tenants` | 目录扫描 + 每个租户的 `status` / `files` / `reason`、本次启动的注册表、`dirError` |

都只收 GET/HEAD（其余 405），`cache-control: no-store`。

### 为什么走 HTTP 路由，而不是 Remote

应用的 Remote 门面（`@deepseek-ai/dsh-api-remotes`）在**构建时**就固定了它挂载的命名空间清单，`agentPresets` 不在里面，README 明确写着客户端「不发现宿主运行时的 Service 或 Remote 定义」。第三方 Client 插件想调宿主方法，只能自己写契约再 `ctx.remote.$mount(descriptors)`——那套 codec/descriptor 和宿主 `@Remote` 签名一一对应，宿主升版就会静默错位。

同源路由更便宜也更诚实：它和 GUI 走同一套 web 鉴权，不需要自己发 token，失败时是个 HTTP 状态码，面板能把码直接印出来。

## 状态是怎么判的

`GET /tenants` 每次重新扫盘，再和**本次启动时**的注册表对照：

| status | 判据 |
| --- | --- |
| `live` | 注册表里有它，且本进程里该租户的预设实例真的跑过 `apply` |
| `registered` | 注册表里有它，但还没有会话用过这个预设（实例没起） |
| `not-registered` | 目录里读到了，注册表里没有——多半是这次启动后才加的，重启即注册 |
| `error` | `tenant.json` 读不了 / 不是 JSON / id 不合法或和目录名不一致，`reason` 写原因 |

`live` / `registered` 的区别是「注入真的挂上了」和「预设只是个空壳」——这条差别值得在界面上分开，不然「加了个租户但没生效」会看起来像生效了。

## 踩过的坑（记下来省得重踩）

1. **React 只有三个 hook**：Client Builtin 目录里只有 `createElement / useState / useEffect`，没有 `useRef / useCallback / useMemo`。用了不报编译错，渲染时抛 TypeError，宿主把那一格 blank 掉——表现是「注册成功但界面上什么都没有」。
2. **`ctx.remote` 不存在**：客户端服务目录只有 layout / locale / sessions / slots / theme / timer / uiWorkspace / workspaces。
3. **composer 会裁浮层**：该槽说明写着 fixed overlay 必须 portal 到 body。这里菜单是 chip 内绝对定位、300px 以内，够用；再大就得 portal。
4. **改完必须重启应用**：Ctrl+R / F5 / 应用菜单在这个窗口都不生效。
5. **别用 PowerShell 改源码**：`Get-Content -Raw` + `-replace` + `Set-Content` 会把 UTF-8 中文按 GBK 解码再写回，文件里就剩问号了。用编辑器/专用文件工具改。
6. **沙箱里 `node --test test/` 会 `spawn EPERM`**（子进程被拦）；直接 `node test/<file>.js` 跑。

## 已知未验证点

1. chip 的视觉是按记忆插件抄的样式数值，重启后要跟旁边的记忆 chip 对齐看一眼。
2. `useProjection('agentPreset')` 的返回可能是字符串也可能包一层对象，代码两种都认；prop 不在时退回「租户」，不会崩。
3. 预设 scope 里的 `systemPrompt.section/context` 是否只对**这个预设的** agent 生效，还没在活宿主上验过——第一次用租户开会话时看 prompt 里有没有 `tenant:<id>:persona` 这一段。
