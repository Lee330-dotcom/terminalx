## Why

需求文档 A2（Snippet / 快捷命令，P0）要求：本地管理常用命令（名称 + 命令 + 可选参数模板 `{var}`，执行时弹窗填参）；在命令面板和终端右键菜单中可一键下发到当前会话；支持按文件夹分组。

现状是**只有一份写死的内置命令表**：`CommandPalette.vue` 里硬编码了 34 条 `ls`/`grep`/`kubectl` 之类的命令，文本、分类、描述全部写死在渲染层源码里。用户想加一条自己每天都要敲的命令，必须改代码重新打包；分组更无从谈起。同时终端没有右键菜单，除了「AI 解释选中文本」之外没有第二个可用动作。

对比 Termius Snippets、FinalShell 快捷命令这类业内标配能力，terminalX 在"常用命令复用"上是明显缺口：运维每天重复输入的启停、巡检、日志查看命令，本该一键下发。

同时这个功能有一条不能踩的红线：项目已确立「禁止向远端 shell 静默注入命令」的约束（AI 插入的命令不回车、全自动只走独立 exec 通道 + 审批）。快捷命令是用户主动触发的动作，但仍要保证**下发的内容对用户完全可见、可复核**，参数替换后必须让用户看到最终命令再确认。

## What Changes

- **片段库持久化**：新增 `src/main/store/snippetStore.ts`，管理「分组 + 片段」两级结构，落盘 `snippets.json`（原子写，模式与 `hostKeyStore.ts`/`jsonFile.ts` 一致）。片段含名称、命令、说明、所属分组、是否执行后自动回车、创建/更新时间。
- **参数模板**：命令里可写 `{name}` 占位符（`name` 为字母/数字/下划线/连字符）。同名占位符只填一次、替换到所有出现位置；片段执行前弹出填参表单，并**展示替换后的完整命令**，用户确认后才下发。
- **执行语义（安全默认）**：下发只写入当前会话的终端输入区，**默认不自动回车**（用户自行按 Enter 执行），与项目「不静默注入」的约束一致；单条片段可显式勾选「执行后自动回车」，勾选后下发内容以 `\r` 结尾。无已连接会话时入口不可用并给出提示，不做静默失败。
- **命令面板打通**：`CommandPalette.vue`（⌘K）把内置命令与用户片段合并到同一搜索结果，片段按所属分组的分类角标展示；选中片段走与右键菜单完全一致的下发路径（含占位符确认弹窗）。
- **终端右键菜单**：终端区域右键弹出快捷命令菜单，按分组分组展示，点击即下发到该终端所在会话。
- **管理界面**：设置面板新增「快捷命令」区块，支持新建/编辑/删除片段、按名称与命令搜索、分组的建/改名/删除；删除分组时其下片段回落为「未分组」而不是被删除。
- **范围界定**：本变更只做全局片段库（所有连接共用一套），不做按连接绑定片段、不做片段导入导出、不做参数输入历史、不做片段脚本化（多行/条件分支）。

## Capabilities

### New Capabilities
- `snippet-management`: 快捷命令（片段）的建模、持久化、分组、参数模板替换与下发能力——管理界面 CRUD + 搜索、命令面板搜索打通、终端右键菜单下发、填参确认后写入当前会话。

### Modified Capabilities
（无：现有 `openspec/specs/` 下没有与快捷命令相关的既有能力，本变更只新增能力，不改变其它能力的对外契约。）

## Impact

- **主进程**
  - 新增 `src/main/store/snippetStore.ts`：分组/片段的读写、增删改、原子写、文件损坏降级
  - 新增 `src/shared/snippets.ts`：占位符解析（`parseSnippetPlaceholders`）与替换（`applySnippetPlaceholders`）纯函数，主/渲染进程共用
  - 修改 `src/main/appContext.ts`：装配 `SnippetStore`
  - 修改 `src/main/ipc.ts`、`src/shared/types.ts`、`src/preload/index.ts`：新增 6 个片段通道与 API 面
- **渲染层**
  - 新增 `src/renderer/src/stores/snippets.ts`：片段库状态与 CRUD
  - 新增 `src/renderer/src/snippets/execute.ts`：统一的下发路径（填参弹窗 → 确认 → 写入当前会话）
  - 修改 `src/renderer/src/components/CommandPalette.vue`：合并片段进搜索结果
  - 修改 `src/renderer/src/components/TerminalView.vue`：右键菜单
  - 修改 `src/renderer/src/components/SettingsPanel.vue`：新增「快捷命令」区块
  - 修改 `src/renderer/src/i18n.ts`：新增文案（中英）
- **测试**
  - 新增 `src/main/store/__tests__/snippetStore.test.ts`：CRUD、分组、分组删除回落、文件损坏降级
  - 新增 `src/shared/__tests__/snippets.test.ts`：占位符解析与替换边界
