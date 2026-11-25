## Why

当前主题层是「19 套颜色预设 + 运行时改写 CSS 变量」的临时方案：令牌散落在 `base.css` 与各组件内（109 处硬编码色值），浅色模式下 Element Plus 仍用默认蓝而界面强调色是绿（`--el-*` 只在 `html.dark` 覆盖），终端 ANSI 配色写死不随主题变化。这让「暗色/亮色双主题完整支持」无法成立，也使后续每一个新组件都要重复踩样式不统一的坑。需求文档把 A11 的第 1、2 项列为 M0 基座，目的正是先立地基、避免二次返工。

## What Changes

- 新增设计令牌层 `src/renderer/src/theme/`：
  - `tokens.ts` 为唯一真相源，定义颜色槽位（背景/面板/卡片/填充/悬停/边框/导航/文字三级/强调色/成功/警告/危险/信息）、圆角、间距、字号、阴影、动效时长与缓动曲线
  - 中性色槽位由「预设背景色」程序化派生（`deriveSurface`），使 19 套既有皮肤视觉保持不变，同时保证任一预设下整套槽位自洽
- 双主题落地：新增 `themeMode` 设置（`light` / `dark` / `system`），取代仅靠背景色深浅隐式推断模式的做法；`system` 跟随 `prefers-color-scheme` 并实时响应系统切换
- 修复 Element Plus 主题变量只覆盖暗色的问题：亮/暗两套模式均完整对齐 `--el-color-primary` 阶、`--el-bg-color`、`--el-border-color`、`--el-fill-color`、`--el-text-color`、`--el-mask-color`
- 终端 ANSI 配色由令牌派生，主题切换时同步刷新已打开的 xterm 实例；搜索高亮装饰一并令牌化
- 清理组件内硬编码色值：`TerminalView.vue`、`AiPanel.vue`、`SettingsPanel.vue`、`App.vue`、`ConnectionTable.vue`、`SftpPanel.vue`、`ConnectionFormDialog.vue`、`ConnectionTree.vue`、`CommandPalette.vue` 全部改引令牌变量（终端 ANSI 16 色调色板按文档豁免）
- 设置项迁移：旧 `followSystemTheme` 读取时迁移为 `themeMode='system'`，其余按当前背景色深浅推导 `light`/`dark`；用户已保存的皮肤与配色不丢失
- **BREAKING**：`Settings` 接口移除 `followSystemTheme`，新增 `themeMode`；备份恢复流程同步适配

## Capabilities

### New Capabilities

- `design-tokens`: 渲染层设计令牌体系与亮/暗双主题——令牌分类与取值契约、预设皮肤派生、主题模式判定、Element Plus 变量对齐、终端配色联动、组件硬编码色值清零

### Modified Capabilities

（无：现有 `openspec/specs/` 下尚无已归档能力，本次为首次落地的令牌能力）

## Impact

- 共享类型：`Settings` 新增 `themeMode`、移除 `followSystemTheme`
- 主进程：`settingsStore` 增加 `themeMode` 默认值与旧字段迁移；备份恢复适配
- 渲染层：新增 `src/renderer/src/theme/tokens.ts`、`xtermTheme.ts`；重写 `theme.ts` 的应用层；`assets/base.css` 改为只保留结构样式与令牌兜底声明
- 渲染层组件：9 个组件的样式改引令牌变量
- 设置页：主题分区新增「外观模式」选择（浅色/深色/跟随系统），皮肤预设与强调色在双主题下各自生效
- 终端：`TerminalView.vue` 监听主题变更事件刷新 xterm 配色
- 测试：新增 `tokens.ts` 派生与模式判定单测；现有组件单测保持通过
