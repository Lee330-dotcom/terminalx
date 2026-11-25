## Why

需求文档 A1（多标签 + 分屏终端，P0）要求主窗口支持多标签页并行打开多个 SSH 会话，单个标签内支持 2×2 以内的水平/垂直分屏，分屏各自持有独立会话且互不串扰。这是 Termius / Tabby / iTerm2 的标配能力，也是后续 A9（本地/串口终端）、A10（输入广播）、B6（多主机批量 AI 运维）的地基——这三项都要求"多会话并存"这一底层能力先行就位。

当前实现是"一个连接一个标签"的扁平结构：`sessionStore.tabs` 是 `SessionTab[]`，`App.vue` 用 `v-show` 渲染全部标签的 `TerminalView`，同一连接重复连接会被去重跳回已有标签。渲染层没有"窗格"概念，因此无法在一个标签内同时观察两台主机。

同时存在一个被单标签结构掩盖的主进程缺陷：同一连接的多个会话共享池化 client，而 `ClientHandle.drop()` 无条件销毁底层连接——一旦多会话并存，关闭其中一个就会连带杀掉另一个的 shell 通道。多标签能力必须先修正这条生命周期语义。

## What Changes

- **多标签**：主窗口顶部标签栏可同时打开多个会话标签，每个标签独立持有一套窗格布局；新增标签、关闭标签、标签切换。
- **分屏**：标签内支持 2×2 以内的窗格布局，分屏轴向可选（左右 / 上下），分隔条可拖拽调整比例；拆分产生的新窗格为空态，内置连接选择器用于在该窗格开启会话。
- **窗格焦点**：标签内焦点窗格唯一确定，键盘输入、终端搜索、SFTP 文件工作区、AI 摘要/会话上下文都跟随焦点窗格。
- **生命周期**：关闭窗格时若标签内只剩一个窗格，则连带关闭整个标签；断线重连保持分屏布局不变。
- **主进程连接池语义修正**：`drop()` 改为引用计数感知——仅当该连接已无其他会话持有时才真正销毁底层 client，修正关闭/重连路径上 release 与 drop 的重复计数。
- **范围界定**：本变更不引入布局持久化（应用重启后回到连接中心）；同一连接可在多个窗格同时打开各自独立的会话。

## Capabilities

### New Capabilities
- `multi-tab-split`: 主窗口多标签工作区与标签内分屏能力——标签与窗格模型、拆分与合并、比例调整、焦点管理、会话在窗格间的归属与生命周期。

### Modified Capabilities
（无：现有 `openspec/specs/` 下没有与终端标签布局相关的既有能力，本变更不改变其它能力的对外契约。）

## Impact

- **渲染层**
  - 新增 `src/renderer/src/workspace/splitTree.ts`（分屏树纯函数）、`src/renderer/src/stores/workspace.ts`（标签/窗格/焦点 store）
  - 新增 `src/renderer/src/components/workspace/`：`SplitNode.vue`（递归分屏容器 + 拖拽分隔条）、`TerminalPane.vue`（窗格外壳）、`PanePicker.vue`（空窗格连接选择器）
  - 重构 `src/renderer/src/App.vue`：标签栏改为多标签，工作区改为分屏容器；SFTP 侧栏、终端搜索、AI 摘要改为跟随焦点窗格
  - `src/renderer/src/stores/sessions.ts` 收缩为"连接使用记录"职责，标签与会话生命周期迁至 workspace store
  - `src/renderer/src/i18n.ts` 增补标签栏、分屏、窗格空态相关文案
- **主进程**
  - `src/main/ssh/connectionManager.ts`：`drop()` 引用计数语义
  - `src/main/ssh/sessionManager.ts`：关闭/重连路径的句柄计数唯一化
  - IPC 通道与 `RendererApi` 签名不变
- **测试**
  - 新增 `src/renderer/src/workspace/__tests__/splitTree.test.ts`
  - 新增 `src/renderer/src/stores/__tests__/workspace.test.ts`
  - 扩充 `src/main/ssh/__tests__/connectionManager.test.ts`（共享连接多句柄 drop 语义）与 `sessionManager` 相关用例
- **依赖**：无新增第三方依赖；IPC 接口不变，不涉及数据迁移
