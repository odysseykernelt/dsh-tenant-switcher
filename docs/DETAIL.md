# 租户切换器

给「租户 = Agent 预设」这件事一个能看见、能点的界面。

## 它做什么

- **对话框里的 chip**：挂在 `conversation.input.left`，也就是输入框工具行左侧、记忆开关 chip 的右边。样式、字号（13px chip / 12px 菜单项）、菜单几何（向上弹、8px 圆角）都照 `dsh-plugin-memory` 的 `memory-session-toggle` 抄。
- **chip 上写当前预设名**：读会话投影 `agentPreset`；没绑定时写「租户」；预设装载失败时圆点变红。
- **换租户 = 开新会话**：点 chip 向上弹出全部预设，点一个就以它开一个新会话。列表按 `order` 排序，副标题用 `description`，`broken` 的预设标「装不起来」且不可点。

## 它不做什么

- **不做「切换」**。注册表在会话跑过第一轮之后会让 `select()` 抛 `agent-preset/locked`，所以租户是开会话时绑定的。界面上不提供假的切换按钮，脚注直接写这句。
- 不读、不改任何记忆目录。它只回答「这个会话是谁」和「给我开一个谁的新会话」。
- 不替换新会话页原生的预设控件（`conversation.hero.agentPreset`），那一个已经够用。

## 依赖的宿主接口

| 用途 | 接口 |
| --- | --- |
| 列出预设 | 自己 Host 半的只读路由 `GET /dsh-tenant-switcher/presets`（内部调 `ctx.agentPresets.list()`） |
| 开新会话 | `ctx.get('uiWorkspace').startSession(undefined, { agentPreset })` |
| 读当前绑定 | 会话作用域 slot 的 `useProjection('agentPreset')` |
| 挂载位置 | `conversation.input.left`（composer 工具行左侧） |
| 文案 | `ctx.locale.register(ns, dicts)` 一次给中英两份 + `ctx.locale.bind(ns)` |

### 为什么预设列表走 HTTP 路由，而不是 Remote

应用的 Remote 门面（`@deepseek-ai/dsh-api-remotes`）在**构建时**就固定了它挂载的命名空间清单，`agentPresets` 不在里面，而且它的 README 明确写着客户端「不发现宿主运行时的 Service 或 Remote 定义」。第三方 Client 插件想调宿主方法，只能自己写契约再 `ctx.remote.$mount(descriptors)`——那套 codec/descriptor 和宿主 `@Remote` 签名一一对应，宿主升版就会静默错位。

同源路由更便宜也更诚实：它和 GUI 走同一套 web 鉴权，不需要自己发 token，失败时是个 HTTP 状态码，面板能把码直接印出来，而不是显示一个空列表。

## 踩过的坑（记下来省得重踩）

1. **React 只有三个 hook**：Client Builtin 目录里只有 `createElement / useState / useEffect`，没有 `useRef / useCallback / useMemo`。用了不会报编译错，会在渲染时抛 TypeError，宿主把那一格 blank 掉——表现为「注册成功但界面上什么都没有」。
2. **`ctx.remote` 不存在**：客户端服务目录只有 layout / locale / sessions / slots / theme / timer / uiWorkspace / workspaces。想调宿主，要么自己写 contract `$mount`，要么走自建路由。
3. **composer 会裁浮层**：该槽的目录说明写着 fixed overlay 必须 portal 到 body。这里菜单是绝对定位在 chip 内的向上弹面板，宽度 300px 以内，够用；再大就得 portal。
4. **改完必须重启应用**：Ctrl+R / F5 / 应用菜单在这个窗口都不生效，只能重启 DSH。

## 已知未验证点

1. chip 的视觉是按记忆插件抄的样式数值，重启后要跟旁边的记忆 chip 对齐看一眼。
2. `useProjection('agentPreset')` 的返回可能是字符串也可能包一层对象，代码两种都认；prop 不在时退回「租户」，不会崩。
3. `ctx.locale.register(ns, dicts)` 两分量重载在活的服务目录里查到了签名，还没在页面里跑过一次。
