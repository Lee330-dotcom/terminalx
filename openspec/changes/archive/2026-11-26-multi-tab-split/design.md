## Context

现状：渲染层 `stores/sessions.ts` 持有扁平 `SessionTab[]`（一连接一标签），`App.vue` 用 `v-show` 渲染全部标签的 `TerminalView`，同一连接重复连接会被去重跳回已有标签；没有"窗格"概念。终端搜索（`utils/terminalSearch.ts` 按 sessionId 注册）、SFTP 侧栏（`activeConnectionId`）、AI 会话上下文（`AiPanel` 取 `activeTab`）都以"当前唯一会话"为锚点。

主进程侧：`SessionManager` 已是 `Map<sessionId, session>`，天然支持多会话并存；`ConnectionManager` 按 connectionId 池化 client，多个会话可复用同一底层 SSH client 打开多条 shell 通道（refCount 计数）。

被单标签结构掩盖的缺陷：`ClientHandle.drop()` 无条件销毁底层 client（`destroy()` 直接 `client.end()`），而 `SessionManager.close()` 走 `handle.drop()`、`reconnect()` 同样 `drop()`、远端自然断开路径则是 `release()` 紧跟 `drop()`——两条路径都存在"同一句柄被计数两次"或"销毁他人正在使用的 client"的问题。单会话时无可观察影响，一旦同一连接存在两个会话，关闭其中一个会连带杀掉另一个。

约束：A11 已交付的设计令牌体系是所有新组件的取值来源；需求文档全局约束要求新增主进程服务配套 Vitest 单测、UI 文案进 `i18n.ts`、颜色/间距不硬编码；`TerminalView` 的 xterm 实例持有滚动缓冲与搜索插件，销毁重建会丢失回滚内容。

## Goals / Non-Goals

**Goals:**
- 主窗口多标签并行，标签各自持有独立窗格布局
- 标签内 2×2 以内分屏，分屏轴向可选、比例可拖拽
- 窗格与解耦：窗格可持有会话，也可处于空态并按需选择连接开启会话
- 焦点窗格唯一确定，SFTP / 终端搜索 / AI 上下文随之联动
- 同一连接的多会话互不牵连（关闭、重连均不影响同连接其它会话）

**Non-Goals:**
- 不做布局持久化（应用重启回到连接中心）
- 不做标签拖拽排序、标签分组、标签预览缩略图
- 不做本地/串口/Telnet 会话类型（A9 依赖本变更的地基，但不在本次实现）
- 不改 IPC 通道与 preload 接口签名
- 不引入 ECharts 等图表或新的第三方依赖

## Decisions

### D1. 分屏布局用二叉树表达，而不是扁平窗格列表

**选择**：布局树节点二选一——叶子 `PaneNode`（持有 paneId）或分屏 `SplitNode`（`axis: 'x' | 'y'` 表示左右/上下排布、`ratio` 表示前子节点占比、`children: [Node, Node]`）。

**理由**：分屏本质是嵌套分割，二叉树是唯一能无损表达"左上下右"这类嵌套布局的结构；扁平列表无法表达比例归属。`ratio` 挂在分屏节点上，拖拽分隔条只需改写一个节点。

**备选**：扁平窗格列表 + 网格行列坐标。实现简单但无法表达不等分的嵌套，且后续 A6 的"分屏内独立切换会话"会受限。

### D2. 窗格与会话解耦，窗格允许空态

**选择**：`PaneState = { id, tabId, sessionId | null, connectionId | null, title, status, errorMessage }`。窗格与主进程会话通过 `sessionId` 关联，空窗格 `sessionId` 为 `null`。

**理由**：拆分产生的空窗格需要"稍后再选连接"的能力（用户已确认的交互）。若窗格直接等同于会话，拆分就必须立刻建立连接，违背"空窗格 + 连接选择器"的决策。

### D3. 布局状态只存在于渲染层，不落盘

**选择**：标签与窗格树保存在 Pinia store（`stores/workspace.ts`），不写入 `settings.json` 或 `localStorage`。

**理由**：用户已确认不恢复上次布局。布局落盘会额外引入凭据解密重连、失败回退、跨版本兼容等成本，与当前收益不成比例。

### D4. 同一连接多会话：共享 client + 引用计数感知的 drop

**选择**：`ClientHandle` 的两个释放动作语义分离——`release()` 归还引用（归零后进入空闲销毁计时），`drop()` 归还引用并**仅当该 client 已无其它持有者时**立即销毁；`sessionManager` 的关闭/重连/自然断开三条路径各自只对同一句柄计数一次。

**理由**：这是"同一连接多会话互不牵连"的前提。现实现 `drop()` 无条件 `client.end()`，关闭任一窗格就会杀掉同连接其它窗格的 shell 通道。

**备选**：同一连接的第二个会话改用 `acquireIsolated()` 独立建连，完全避开池共享。语义更简单，但同一主机会出现多条 TCP 连接，登录次数与资源占用翻倍，且失去连接池的复用收益。

**取舍**：连接池共享下，远端堡垒机"关闭一条通道即拆除整个 SSH 会话"的行为会让同连接其它窗格一起断开——这是远端行为，无法在客户端规避；此时所有窗格进入 disconnected 状态，用户可逐个重连。

### D5. 焦点窗格是唯一联动锚点

**选择**：每个标签持有一个 `focusedPaneId`；SFTP 侧栏、终端搜索、AI 摘要与 AI 会话上下文全部改为读取"当前标签焦点窗格的 sessionId"，而非"当前标签的第一个窗格"。

**理由**：分屏下"当前会话"不再唯一。保持单一锚点可避免多处各自推断焦点导致的不一致。

### D6. TerminalView 保持为叶子组件，分屏容器只管布局

**选择**：不重构 `TerminalView` 的 xterm 生命周期与输入处理，仅把它作为窗格内容使用；新增 `workspace/` 目录下的 `SplitNode.vue`（递归渲染 + 拖拽分隔条）、`TerminalPane.vue`（窗格外壳：标题栏、状态、拆分/关闭按钮）、`PanePicker.vue`（空窗格连接选择器）。

**理由**：`TerminalView` 已封装 xterm 创建、搜索插件注册、主题联动、AI 解释按钮等，重构收益低风险高。分屏只需要一个能表达"把两个区域按比例排布并提供可拖拽分隔条"的容器。

### D7. 所有窗格常驻挂载，切换用 v-show 而非 v-if

**选择**：标签内所有窗格的 `TerminalView` 始终挂载，非焦点/非激活标签的窗格用 `display: none` 隐藏。

**理由**：xterm 实例重建会丢失滚动缓冲与搜索状态；`v-show` 保留实例，与现有"标签切换用 v-show"的做法一致。窗格尺寸变化由 `TerminalView` 已有的 `ResizeObserver` → `safeFit()` 覆盖，分隔条拖拽引起的 resize 同样自动触发 fit。

### D8. 快捷键

**选择**：`⌘T` 新标签、`⌘W` 关闭焦点窗格（仅剩一个窗格时等价于关闭标签）、`⌘D` 左右分屏、`⇧⌘D` 上下分屏、`⌥⌘←/→` 在标签内循环焦点窗格、`⌘1..9` 切换到第 N 个标签。

**理由**：与 macOS 终端类工具习惯一致；分屏与焦点切换属于高频操作，纯鼠标成本过高。

## Risks / Trade-offs

- **共享 client 下的重连竞态**：堡垒机拆除整个 SSH 会话后，client 已死但尚未触发 `close` 事件，此时重连可能复用死 client 导致连接失败 → 重连失败时窗格进入 error 状态并提供重连按钮，用户可再次重连；必要时可在错误路径上强制丢弃池中 client
- **多窗格同时渲染多个 xterm 的性能开销** → 窗格上限 4；非焦点标签的窗格虽然挂载但不可见，xterm 在隐藏状态下不产生重绘
- **拖拽分隔条期间的频繁 resize** → 拖拽中只改 CSS 比例，`ResizeObserver` 的 fit 有 try/catch 兜底；必要时对 fit 做帧级节流
- **`drop()` 语义变更影响既有单会话路径** → 单会话下 refCount 归零即销毁，与原行为一致；扩充连接池单测覆盖双句柄场景
- **同一连接多会话带来更多服务端 channel** → 受服务端 `MaxSessions` 限制；channel 耗尽时新窗格连接失败并提示，不影响已开窗格

## Migration Plan

1. 先修正主进程连接池 `drop()` 语义与句柄计数，补充单测（可独立发布，无行为回归）
2. 新增 `workspace/splitTree.ts` 纯函数与 `stores/workspace.ts`，补齐单测
3. 新增 `components/workspace/` 三个组件
4. 改造 `App.vue`：多标签栏 + 分屏工作区，联动点改为焦点窗格
5. `stores/sessions.ts` 收缩为连接使用记录；`AiPanel.vue` 等消费方切换到 workspace store
6. 回滚策略：渲染层改动集中在新组件与 App.vue，可整体回退；主进程 `drop()` 语义修正为向后兼容改动，回退后多窗格同连接场景会退化为"关闭一个连带关闭另一个"，不影响单会话使用

## Open Questions

无。分屏交互（空窗格 + 连接选择器）、布局持久化取舍、本轮范围（A1 单项）均已确认。
