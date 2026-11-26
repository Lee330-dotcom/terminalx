# 实施任务（tasks.md）

## 1. 主进程：片段库与占位符

- [x] 1.1 新增 `src/shared/snippets.ts`：`parseSnippetPlaceholders`（按首次出现顺序去重）与 `applySnippetPlaceholders`（原样替换、缺失值替换为空串）；验证：`src/shared/__tests__/snippets.test.ts` 覆盖正常、重复占位符、非法占位符、缺失值
- [x] 1.2 新增 `src/main/store/snippetStore.ts`：分组/片段读写、原子写、进程内写锁、文件损坏降级；验证：`src/main/store/__tests__/snippetStore.test.ts` 覆盖 CRUD、分组删除回落、并发保存、损坏降级
- [x] 1.3 修改 `src/shared/types.ts`：新增 `Snippet` / `SnippetGroup` / `SnippetLibrary` / `SnippetInput` 类型与 6 个 IPC 通道
- [x] 1.4 修改 `src/main/appContext.ts`：装配 `SnippetStore`
- [x] 1.5 修改 `src/main/ipc.ts`：注册 `snippet:list` / `snippet:upsert` / `snippet:delete` / `snippet:group-create` / `snippet:group-rename` / `snippet:group-delete`
- [x] 1.6 修改 `src/preload/index.ts`：暴露 `listSnippets` / `upsertSnippet` / `deleteSnippet` / `createSnippetGroup` / `renameSnippetGroup` / `deleteSnippetGroup`

## 2. 渲染层：状态与统一下发路径

- [x] 2.1 新增 `src/renderer/src/stores/snippets.ts`：片段库状态、加载与 CRUD、当前分组/搜索过滤
- [x] 2.2 新增 `src/renderer/src/snippets/execute.ts`：统一下发路径（无会话提示 → 占位符填参与确认 → 写入当前会话，默认不回车）
- [x] 2.3 修改 `src/renderer/src/i18n.ts`：新增 `snippet.*` 中英文案

## 3. 渲染层：入口与管理界面

- [x] 3.1 修改 `src/renderer/src/components/CommandPalette.vue`：内置命令与片段合并搜索、片段显示分组角标、选中片段走统一下发路径
- [x] 3.2 修改 `src/renderer/src/components/TerminalView.vue`：终端右键菜单，按分组展示片段，点击下发到本终端会话
- [x] 3.3 新增 `src/renderer/src/components/SnippetManager.vue`：列表 + 搜索 + 分组筛选 + 新建/编辑/删除片段 + 分组建/改名/删
- [x] 3.4 修改 `src/renderer/src/components/SettingsPanel.vue`：新增「快捷命令」区块并挂载 `SnippetManager.vue`

## 4. 验证与收尾

- [x] 4.1 `npm run typecheck` 通过
- [x] 4.2 `npm run test` 通过（含新增单测）
- [x] 4.3 `npm run dev` 供用户预览：新建片段 → 命令面板搜索命中 → 右键菜单下发 → 占位符填参确认
- [x] 4.4 `openspec validate snippet-commands --strict` 通过
- [ ] 4.5 变更归档：`openspec archive snippet-commands -y` 并更新 `openspec/specs/`
