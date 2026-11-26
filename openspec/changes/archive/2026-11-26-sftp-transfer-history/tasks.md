# 实施任务（tasks.md）

## 1. 主进程：传输记录与事件

- [x] 1.1 新增 `src/main/store/transferStore.ts`：记录写入（start/progress/finish）、查询、删除、清空、上限裁剪、原子写与写锁、损坏降级；验证：`src/main/store/__tests__/transferStore.test.ts`
- [x] 1.2 修改 `src/shared/types.ts`：新增 `TransferRecord` / `TransferStartEvent` 类型与 `ev:transfer:start`、`transfer:records-list` 等 IPC 通道
- [x] 1.3 修改 `src/main/ssh/sftpService.ts`：`TransferEventSink` 增加 `emitStart`，`enqueue` 时同步广播
- [x] 1.4 修改 `src/main/appContext.ts`：装配 `TransferStore`，在传输 sink 中落库
- [x] 1.5 修改 `src/main/ipc.ts`：注册记录查询/删除/清空与「打开位置」处理（`shell.showItemInFolder`）
- [x] 1.6 修改 `src/preload/index.ts`：暴露对应 API

## 2. 渲染层：传输状态与记录

- [x] 2.1 修改 `src/renderer/src/stores/transfers.ts`：监听 start 建条目、完成后保留条目、维护历史记录列表与清理动作
- [x] 2.2 修改 `src/renderer/src/components/SftpPanel.vue`：传输框展示全部状态条目（含状态、大小、打开位置、取消、清空）
- [x] 2.3 修改 `src/renderer/src/components/SftpPanel.vue`：新增「下载记录」工具栏入口与记录抽屉（过滤、列表、定位、删除、清空）
- [x] 2.4 修改 `src/renderer/src/i18n.ts`：新增文案（中英）

## 3. 验证与收尾

- [x] 3.1 `npm run typecheck` 通过
- [x] 3.2 `npm run test` 通过（含新增单测）
- [x] 3.3 `npm run test:e2e` 通过
- [x] 3.4 `npm run dev` 供用户预览：连续下载两个文件 → 传输框保持可见；「下载记录」可见历史
- [x] 3.6 手动验证脚本 `src/e2e/verify-transfer-history.manual.ts`：注入已完成/失败条目，断言传输框保留条目并显示状态、记录抽屉可打开
- [x] 3.5 `openspec validate sftp-transfer-history --strict` 通过
