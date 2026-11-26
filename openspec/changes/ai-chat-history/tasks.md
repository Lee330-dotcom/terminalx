# 实施任务（tasks.md）

## 1. 主进程：对话历史存储

- [x] 1.1 新增 `src/shared/types.ts`：`AiChatMessage` / `AiChatConversation` 类型与 4 个对话历史 IPC 通道
- [x] 1.2 新增 `src/main/store/aiChatStore.ts`：保存/更新/查询/删除/清空、上限裁剪、原子写与写锁、损坏降级；验证：`src/main/store/__tests__/aiChatStore.test.ts`
- [x] 1.3 修改 `src/main/appContext.ts`：装配 `AiChatStore`
- [x] 1.4 修改 `src/main/ipc.ts`：注册 `ai:chat-history-list` / `-save` / `-delete` / `-clear`
- [x] 1.5 修改 `src/preload/index.ts`：暴露对应 API

## 2. 渲染层：历史状态与面板入口

- [x] 2.1 新增 `src/renderer/src/stores/aiChatHistory.ts`：历史列表、当前对话 id、持久化、回看与清理
- [x] 2.2 修改 `src/renderer/src/stores/aiChat.ts`：发送与对话结束时自动保存、加载历史到时间线
- [x] 2.3 修改 `src/renderer/src/components/AiPanel.vue`：新增「新对话」「历史」入口与历史抽屉（列表、回看、删除、清空）
- [x] 2.4 修改 `src/renderer/src/i18n.ts`：新增文案（中英）

## 3. 验证与收尾

- [x] 3.1 `npm run typecheck` 通过
- [x] 3.2 `npm run test` 通过（含新增单测）
- [x] 3.3 `npm run test:e2e` 通过（24 例全绿，含新增的对话历史用例）
- [x] 3.4 `npm run dev` 供用户预览：对话 → 历史抽屉可见记录 → 重启后仍在
- [x] 3.5 `openspec validate ai-chat-history --strict` 通过
