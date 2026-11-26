# 实施任务（tasks.md）

## 1. 主进程：连接池与句柄生命周期

- [x] 1.1 `ClientHandle.drop()` 改为引用计数感知：归还引用，仅当该 client 无其它持有者时立即销毁；验证：`connectionManager.test.ts` 新增「同一连接两个句柄，drop 其一不影响另一个，重新 acquire 仍复用同一 client」用例
- [x] 1.2 `sessionManager` 三条释放路径（用户关闭 / 远端自然断开 / 重连）各自只对同一句柄计数一次，移除 `release()` 与 `drop()` 连用造成的重复计数；验证：`sessionManager` 相关用例通过，且「同一连接两个会话，关闭其一，另一个仍可输入输出」用例通过
- [x] 1.3 `npm run typecheck` 与 `npm run test` 全绿（主进程部分不引入新 IPC 通道）

## 2. 渲染层：分屏树纯函数

- [x] 2.1 新增 `src/renderer/src/workspace/splitTree.ts`：定义 `PaneNode` / `SplitNode` / `LayoutNode` 类型与 `createPaneNode` / `createSplitNode` / `splitPane` / `removePane` / `findPaneNode` / `findSplitNode` / `findParentSplitId` / `collectPaneIds` / `countPanes` / `mapLayout` / `updateRatio` 等纯函数；验证：`workspace/__tests__/splitTree.test.ts` 覆盖拆分、折叠、比例写入与越界
- [x] 2.2 比例约束：任一子窗格占比不低于 10%，比例写入做区间钳制；验证：单测断言越界比例被钳制
- [x] 2.3 窗格上限 4：`splitPane` 在已达上限时返回原树并由调用方提示；验证：单测断言第 5 次拆分不改变树

## 3. 渲染层：workspace store

- [x] 3.1 新增 `src/renderer/src/stores/workspace.ts`：标签列表、窗格表、每标签 `focusedPaneId`、布局树；验证：`stores/__tests__/workspace.test.ts` 覆盖标签增删与激活
- [x] 3.2 会话生命周期：窗格开启会话（允许同一连接开多条独立会话）、关闭窗格（连带关闭标签的最后一个窗格时关闭标签）、重连保持布局；验证：store 单测覆盖上述三条
- [x] 3.3 主进程会话状态事件路由到对应窗格（按 sessionId 定位窗格）；验证：store 单测模拟状态事件后窗格状态更新
- [x] 3.4 `stores/sessions.ts` 收缩为连接使用记录职责，`App.vue` / `AiPanel.vue` 等消费方切换到 workspace store；验证：`npm run typecheck` 通过且无遗留 `sessionStore.tabs` 引用

## 4. 渲染层：工作区 UI

- [x] 4.1 新增 `components/workspace/WorkspaceGrid.vue`：把分屏树摊平为绝对定位的窗格网格（`splitTree.ts` 的 `computeLayout`），提供可拖拽分隔条（拖拽更新比例并调用窗格 fit）；平铺渲染保证拆分时原窗格组件不卸载、终端滚动缓冲不丢失；验证：组件可挂载、样式取自设计令牌（`grep` 无硬编码色值），且有「拆分后原窗格 DOM 实例不变」的回归用例
- [x] 4.2 新增 `components/workspace/TerminalPane.vue`：窗格外壳（标题、状态标识、拆分按钮、关闭按钮），承载 `TerminalView` 或空态；验证：组件可挂载
- [x] 4.3 新增 `components/workspace/PanePicker.vue`：空窗格连接选择器（搜索 + 列表 + 取消）；验证：选择后触发开启会话、取消不发起连接
- [x] 4.4 `App.vue` 改造：多标签栏（新增、关闭、切换、窗格数徽标），工作区改为分屏容器；验证：dev 版可见多标签与分屏
- [x] 4.5 联动改造：SFTP 侧栏、终端搜索、AI 摘要与 AI 会话上下文改跟随焦点窗格；验证：切换焦点窗格后上述区域同步切换
- [x] 4.6 快捷键：`⌘T` 新标签、`⌘W` 关闭焦点窗格、`⌘D` 左右分屏、`⇧⌘D` 上下分屏、`⌥⌘←/→` 循环焦点、`⌘1..9` 切换标签；验证：dev 版逐个验证
- [x] 4.7 `i18n.ts` 增补标签栏、分屏、窗格空态、比例上限提示等文案（不硬编码中文）；验证：新增文案中英文齐全

## 5. 验证

- [x] 5.1 `npm run typecheck` 与 `npm run test` 全绿（单测 224 条）
- [x] 5.2 `npm run dev` 供用户预览：多标签并行、分屏拆分与比例拖拽、焦点联动、同连接双窗格互不牵连
- [x] 5.3 `openspec validate multi-tab-split --strict` 通过
- [x] 5.4 端到端：`src/e2e/workspace.spec.ts` 覆盖多标签切换、拆分后并行会话、比例拖拽、关闭窗格会话存活、⌘T/⌘W 与主题切换；`src/e2e/app.spec.ts` 同步适配多标签结构；验证：`npx vitest run --config vitest.e2e.config.ts` 共 19 条用例全绿
