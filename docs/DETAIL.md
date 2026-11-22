# 租户切换器

给「租户 = 一个工作区」这件事一个能跑起来的实现：**按会话的工作目录认出租户、只给它注入人格与记忆、不吃全局记忆库的租户顺手关掉**，外加一个能看见状态、能直接点进去的界面。

0.3 那版把租户做成 Agent 预设，两个问题在真实会话里立刻暴露：预设是一维的，绑了租户就选不了官方模式；记忆插件是根作用域单例，叠加只能加不能减，于是每个租户都记得全局那一套。0.4 换成工作区，两个轴各归各位。

## 它做什么

**宿主半（`index.js` + `tenants.js`）**

- **扫目录**：启动时读 `~/.dsh/tenants/*/`，目录名就是租户 id（小写字母/数字/`-`/`_`，1–48 位），`tenant.json` 描述它。
- **建工作区**：每个租户的 `workspaceDir` 递归建出来（幂等）。工作区是绑定的钥匙，必须先存在。
- **按 cwd 绑定**：`agent/created` 时看会话的工作目录落在哪个租户的工作区里（按路径边界、最长匹配），是哪个就只给哪个注入；已有的 agent 启动时也会补一遍。
- **注入**：`agent.ctx.inject(['systemPrompt'], …)` 里加 `tenant:<id>:persona`（section，order 300）和 `tenant:<id>:memory`（context，order 310，含 `memory/SOUL.md` + `memory/index.md`）。材料装载时读一次，缺文件就是空串，不致命。
- **关掉不属于它的记忆**：`inheritGlobalMemory: false` 的租户，绑定成功后 POST `dsh-plugin-memory` 的 `/api/memory/session`（`{ sessionId, action: 'off' }`）。走它的路由，因为 `memory-sessions.json` 只在启动时读一次，改文件没用；失败只 warn，不假装成功。
- **坏租户不消失**：JSON 坏、id 不合法、`id` 和目录名不一致，都列成一条带原因的 `error` 行，并 `logger.warn` 一次。不静默跳过。

**浏览器半（`client.js`）**

- chip 挂在 `conversation.input.left`（输入框工具行左侧、记忆开关 chip 右边），样式、字号（13px chip / 12px 菜单项）、菜单几何（向上弹、8px 圆角）都照 `dsh-plugin-memory` 的 `memory-session-toggle`。
- chip 上写**当前会话的租户名**（`GET /tenants?sessionId=…` 的 `current`，宿主按 cwd 算出来的）；不在任何租户里就退回当前预设名。
- 面板：当前租户一行 → 租户目录列表（每条：状态点 + 名字 + 状态字，坏的那行下面跟原因）；**每行可点**，点了就 `workspaces.create({ path })` 把这个工作区注册进来，再用 `uiWorkspace.startSession(workspaceId)` 在里面开新会话。→ 「＋ 添加新租户」→ 模板视图（原文 + 复制 + 存到哪 + 要重启）。

## 它不做什么

- **不占官方模式**。预设有自己的轴，租户是工作区，两边不抢位。
- **不「切换」正在跑的会话**。工作目录是会话的创建事实，中途换目录等于换会话。
- **不写记忆**。现在只读 `SOUL.md` / `index.md`，改了会丢。
- **不执行 `tools` / `model` / `sandbox` / `mailbox`**。这四个字段被读进记录，没有代码用它们。
- 不替换新会话页原生的预设控件（`conversation.hero.agentPreset`）。

## 三条只读路由

| 路由 | 内容 |
| --- | --- |
| `GET /dsh-tenant-switcher/tenants` | 目录扫描 + 每个租户的 `workspace` / `workspaceExists` / `files` / `reason`；带 `?sessionId=` 时多回 `current` |
| `GET /dsh-tenant-switcher/tenant-template` | 随包的 `templates/tenant.json` |
| `GET /dsh-tenant-switcher/presets` | 旧的预设名单（0.3 那版装过的机器排错用） |

都只收 GET/HEAD（其余 405），`cache-control: no-store`。

每行除 `files`，还带 `persona` 和 `memoryDir` 两个**解析后的绝对路径**：`memoryDir` 允许是绝对路径（直接挂现成记忆库），只看到文件名会分不清「没找到文件」和「找错了地方」。

### 为什么走 HTTP 路由，而不是 Remote

应用的 Remote 门面（`@deepseek-ai/dsh-api-remotes`）在**构建时**就固定了它挂载的命名空间清单，`agentPresets` 不在里面，README 明确写着客户端「不发现宿主运行时的 Service 或 Remote 定义」。第三方 Client 插件想调宿主方法，只能自己写契约再 `ctx.remote.$mount(descriptors)`——那套 codec/descriptor 和宿主 `@Remote` 签名一一对应，宿主升版就会静默错位。

同源路由更便宜也更诚实：它和 GUI 走同一套 web 鉴权，不需要自己发 token，失败时是个 HTTP 状态码，面板能把码直接印出来。

## 状态是怎么判的

`GET /tenants` 每次重新扫盘：

| status | 判据 |
| --- | --- |
| 可开（`workspaceExists: true`） | 描述读到了、工作区目录在，点一下就能开 |
| 工作区待建（`workspaceExists: false`） | 描述读到了，工作区目录还没建出来（下次启动会建） |
| `error` | `tenant.json` 读不了 / 不是 JSON / id 不合法或和目录名不一致，`reason` 写原因 |

目录不存在不算错：`exists: false` + `dirError` 一句话，菜单里显示成普通注释，红字留给真的坏了的东西。

## 踩过的坑（记下来省得重踩）
1. **React 只有三个 hook**：Client Builtin 目录里只有 `createElement / useState / useEffect`，没有 `useRef / useCallback / useMemo`。用了不报编译错，渲染时抛 TypeError，宿主把那一格 blank 掉——表现是「注册成功但界面上什么都没有」。
2. **`ctx.remote` 不存在**：客户端服务目录只有 layout / locale / sessions / slots / theme / timer / uiWorkspace / workspaces。
3. **composer 会裁浮层**：该槽说明写着 fixed overlay 必须 portal 到 body。这里菜单是 chip 内绝对定位、300px 以内，够用；再大就得 portal。
4. **改完必须重启应用**：Ctrl+R / F5 / 应用菜单在这个窗口都不生效。
5. **别用 PowerShell 改源码**：`Get-Content -Raw` + `-replace` + `Set-Content` 会把 UTF-8 中文按 GBK 解码再写回，文件里就剩问号了。用编辑器/专用文件工具改。
6. **沙箱里 `node --test test/` 会 `spawn EPERM`**（子进程被拦）；直接 `node test/<file>.js` 跑。
7. **绝对路径不能直接 `join`**：`path.join(dir, 'C:/x')` 在 win32 上会拼成 `dir/C:/x`，不是 `C:/x`。`memoryDir` 这类字段先判 `isAbsolute` 再决定拼不拼（`tenants.js` 的 `resolveIn`）。
8. **一维装不下两个轴**：预设既是行为又是身份时，绑了租户就选不了模式。租户用工作区承载，模式留给预设。
9. **叠加不能减**：根作用域单例对所有 agent 无条件注入，想「某个租户不吃全局记忆」只能让那个单例自己关（走它的路由），不能靠再加一层。

## 已知未验证点

1. chip 的视觉是按记忆插件抄的样式数值，重启后要跟旁边的记忆 chip 对齐看一眼。
2. `useProjection('agentPreset')` 的返回可能是字符串也可能包一层对象，代码两种都认；prop 不在时退回「租户」，不会崩。
3. `workspaces.create({ path })` → `uiWorkspace.startSession(workspaceId)` 这条点击链路只在离线测试里验过形状，没在活宿主上点过。
