## Design

### 数据模型

```ts
export interface SnippetGroup {
  id: string
  name: string
  /** 展示顺序，小的在前 */
  order: number
  createdAt: number
}

export interface Snippet {
  id: string
  /** 名称，命令面板与右键菜单里展示 */
  name: string
  /** 命令正文，可含 {name} 占位符 */
  command: string
  /** 说明，可空 */
  description: string
  /** 所属分组；null 表示未分组 */
  groupId: string | null
  /** 下发后是否自动回车，默认 false */
  autoEnter: boolean
  createdAt: number
  updatedAt: number
}

export interface SnippetLibrary {
  groups: SnippetGroup[]
  snippets: Snippet[]
}
```

文件结构 `snippets.json`：

```json
{ "groups": [...], "snippets": [...] }
```

### 存储层：`src/main/store/snippetStore.ts`

沿用 `HostKeyStore` 的成熟模式：

- `readJson` / `writeJsonAtomic` 读写（`src/main/store/jsonFile.ts`）
- 进程内串行锁（`writeChain`）把「读—改—写」串起来，避免并发保存互相覆盖
- 文件损坏时降级为空库，不阻断终端主链路
- API：`list()` / `upsert(input)` / `remove(id)` / `createGroup(name)` / `renameGroup(id, name)` / `removeGroup(id)`

`upsert` 语义：有 `id` 则更新（保留 `createdAt`，刷新 `updatedAt`），无 `id` 则新建并生成 `id`。命令与名称为空时抛错，由渲染层拦截并提示。

`removeGroup` 语义：删除分组，并把该分组下片段的 `groupId` 置为 `null`（不删片段）。

### 占位符：`src/shared/snippets.ts`

纯函数，主/渲染进程共用（主进程做保存时的合法性检查，渲染进程做填参与替换）。

- 语法：`{name}`，`name` 匹配 `[A-Za-z0-9_-]+`
- `parseSnippetPlaceholders(command): string[]` —— 按首次出现顺序返回去重后的占位符名；无占位符返回空数组
- `applySnippetPlaceholders(command, values): string` —— 把 `{name}` 替换为对应值；未提供的占位符替换为空字符串；值原样插入（不做 shell 转义，最终命令在确认弹窗里完整可见，由用户复核）
- 非法占位符（如 `{带空格}`、`{}`）不视为占位符，按普通文本保留

### 执行路径：`src/renderer/src/snippets/execute.ts`

所有入口（命令面板、右键菜单、管理界面「执行」按钮）共用同一条路径，避免三处行为不一致：

```
executeSnippet(snippet, sessionId)
  ├─ 无 sessionId → 提示「当前没有已连接的会话」，结束
  ├─ 有占位符 → 弹窗填参 + 预览替换后命令 → 用户确认
  │     └─ 用户取消 → 结束，不下发
  ├─ 替换后命令为空 → 提示，结束
  └─ window.api.sendInput(sessionId, encode(command + (autoEnter ? '\r' : '')))
```

关键约束：

- **只写入当前会话**：sessionId 由调用方传入（命令面板取活动会话，右键菜单取所属终端的会话），不存在后台注入
- **默认不回车**：`autoEnter` 默认 `false`，命令进入终端输入区后由用户按 Enter 执行；勾选「执行后自动回车」的片段才追加 `\r`
- **参数可见**：确认弹窗展示替换后的完整命令，参数原样插入，用户点「执行」即视为知情

### 入口一：命令面板

`CommandPalette.vue` 把内置命令与片段合并为统一结果项：

```ts
interface PaletteItem {
  key: string
  label: string
  description: string
  category: string
  /** 内置命令直接下发文本；片段走 executeSnippet */
  builtin?: string
  snippet?: Snippet
}
```

搜索命中规则：内置命令按 label/description/category，片段按 name/command/description/分组名。片段的分类角标显示分组名（未分组显示「快捷命令」）。回车选中片段 → 调 `executeSnippet`，不再关闭面板直到确认完成（确认弹窗覆盖在面板之上，取消则保留面板）。

### 入口二：终端右键菜单

`TerminalView.vue` 在容器上监听 `contextmenu`，阻止默认菜单，用 `el-popover`（`trigger="manual"`）在鼠标位置渲染菜单：

- 顶部列出分组名分组下的片段（未分组片段归入「未分组」）
- 点击菜单项 → `executeSnippet(snippet, props.sessionId)`，随后关闭菜单
- 菜单为纯命令入口，不提供「粘贴/复制」等系统项，避免与 xterm 自身交互冲突
- 右键菜单由 `TerminalView` 自持，`snippetStore` 为全局状态，天然支持多标签/分屏各看各的

### 入口三：设置面板「快捷命令」区块

在 `SettingsPanel.vue` 的 `sections` 中新增 `{ id: 'snippets', key: 'snippet.section', icon: EditPen }`：

- 顶部工具条：搜索框（按名称/命令/说明过滤）、分组筛选下拉、「新建分组」「新建片段」按钮
- 分组以可折叠分组展示（Element Plus `el-collapse`），组内是片段表格：名称、命令预览、分组、编辑/执行/删除
- 编辑用 `el-dialog` 表单：名称、命令、说明、分组下拉、「执行后自动回车」开关；表单实时预览最终命令
- 片段无占位符时「执行」按钮直接下发；有占位符时先弹填参确认

### 错误处理

| 场景 | 行为 |
| --- | --- |
| `snippets.json` 损坏 | 降级为空库，界面显示空列表，用户新建后覆盖写回 |
| 保存时名称/命令为空 | 渲染层拦截并提示，不发 IPC |
| 无已连接会话 | 入口禁用或提示，不下发任何内容 |
| 填参弹窗被取消 | 不下发，命令面板保持打开 |
| 分组删除 | 该组片段回落为未分组，不丢失片段 |

### 测试策略

- 主进程单测：`snippetStore` 的 CRUD、分组删除回落、并发保存串行、文件损坏降级
- 纯函数单测：占位符解析/替换的正常与边界（重复占位符、非法占位符、缺失值）
- 渲染层以 `npm run dev` 人工验证为主（填参确认、命令面板搜索命中、右键菜单下发）
