# 实施任务（tasks.md）

## 1. 类型与设置迁移

- [x] 1.1 `Settings` 新增 `themeMode: 'light' | 'dark' | 'system'`，移除 `followSystemTheme`；验证：`npm run typecheck` 通过
- [x] 1.2 `settingsStore` 默认值改为 `themeMode: 'dark'`（延续旧默认 `followSystemTheme=false` 的固定深色观感）；`get()` 与 `replace()` 中把旧 `followSystemTheme=true` 迁移为 `system`，否则按当前背景色深浅迁移为 `light`/`dark`；验证：`settingsStore.test.ts` 覆盖三种旧配置 + 缺失兜底 + 备份恢复
- [x] 1.3 旧字段不再作为有效设置项存在，仅在迁移代码与迁移测试中保留引用；验证：`grep -rn "followSystemTheme" src` 命中仅限 `settingsStore.ts` 迁移分支与 `settingsStore.test.ts`

## 2. 令牌层

- [x] 2.1 新增 `src/renderer/src/theme/tokens.ts`：定义颜色槽位（bg/panel/card/fill/hover/border/borderStrong/nav/text/text2/text3/accent/accentHover/accentSoft/success/warning/danger/info/overlay/shadowColor）、圆角、间距、字号、阴影、动效六类令牌；验证：`tokens.test.ts` 断言每类令牌非空、命名唯一、尺度令牌不含颜色字面量
- [x] 2.2 实现 `deriveSurface(baseBg, navColor)`：由背景色派生整套中性槽位，深浅自动判定，并内置一级文字对比度修正（低于 WCAG AA 阈值时向高对比方向调整）；验证：`tokens.test.ts` 覆盖深色系、浅色系与纯黑/纯白极端底色
- [x] 2.3 实现强调色阶派生（`--el-color-primary` 的 light-3/5/7/8/9 与 dark-2）与深浅判定工具函数；验证：`tokens.test.ts` 断言阶序单调

## 3. 主题应用层

- [x] 3.1 重写主题应用层为 `src/renderer/src/theme/index.ts`（`theme.ts` 已删除）：`resolveMode()` 判定 light/dark/system → 计算令牌 → 写入全部 `--tx-*` 与 `--el-*` 变量 → 广播 `tx-theme-change` 事件；保留 `THEME_PRESETS` 与 `applyUiSettings` 导出签名兼容；验证：`tokens.test.ts` 断言模式判定与变量写入结果
- [x] 3.2 `assets/base.css` 收敛为结构样式 + 深色优先兜底声明，移除与派生逻辑重复的中性色定义；验证：dev 观察首帧无闪白
- [x] 3.3 新增 `src/renderer/src/theme/xtermTheme.ts`：ANSI 16 色调色板与搜索高亮装饰由令牌派生，提供亮/暗两套；验证：`xtermTheme.test.ts` 断言两套配色存在且前景与背景对比度达标

## 4. 组件令牌化

- [x] 4.1 `TerminalView.vue`：移除内联颜色字面量，改引令牌；ANSI 调色板移入 `xtermTheme.ts`；验证：现有组件单测通过
- [x] 4.2 `AiPanel.vue`、`SettingsPanel.vue`、`App.vue`：改引令牌；验证：现有组件单测通过
- [x] 4.3 `ConnectionTable.vue`、`ConnectionTree.vue`、`ConnectionFormDialog.vue`、`SftpPanel.vue`、`CommandPalette.vue`：改引令牌；验证：现有组件单测通过
- [x] 4.4 校验：`grep -rn "#[0-9a-fA-F]\{3,8\}" src/renderer/src/components src/renderer/src/App.vue` 仅命中连接配色数据值（`#10b981` 作为连接标签色数据，非样式）与测试固定值，无样式硬编码

## 5. 交互与联动

- [x] 5.1 设置页主题分区新增「外观模式」单选（浅色/深色/跟随系统），文案进 `i18n.ts`；切换即时生效无需重启；验证：`SettingsPanel.test.ts` 通过，dev 版切换观察
- [x] 5.2 `TerminalView.vue` 监听 `tx-theme-change` 事件刷新 `term.options.theme`，会话不中断；验证：dev 版切换主题后终端配色变化、连接保持
- [x] 5.3 `followSystemTheme` 旧入口与文案清理完毕（设置页「跟随系统」开关卡片已移除）；验证：设置页无失效开关

## 6. 验证

- [x] 6.1 `npm run typecheck` 与 `npm run test` 全绿（20 个测试文件 / 186 个用例）
- [ ] 6.2 双主题走查：浅色/深色/跟随系统三态下逐页走查无样式破损，终端、设置、AI、SFTP、连接树无错位；侧栏与 1920×1080、2560×1440 下无错位（待用户预览确认）
- [ ] 6.3 提交前 `npm run dev` 供用户预览确认
