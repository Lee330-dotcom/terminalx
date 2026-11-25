## Context

现状：`theme.ts`（165 行）是「预设 → 运行时改写 `document.documentElement` 内联 CSS 变量」的应用层，`THEME_PRESETS` 19 套皮肤每套只带 `themeColor`/`backgroundColor`/`navColor` 三色；`assets/base.css` 用 `:root`（浅）+ `html.dark`（深）两段声明 `--tx-*` 令牌，但 `--el-*`（Element Plus）只写在 `html.dark` 段内，浅色模式因此使用组件库默认蓝；`TerminalView.vue` 内 xterm 的 ANSI 调色板为写死字面量。组件内共 109 处颜色字面量（TerminalView 32 处占多数，其中 ANSI 调色板按需求文档豁免）。

约束：需求文档 A11 第 1、2 项限定为「纯视觉层改造，不改业务逻辑与 IPC 接口」；全局约束要求颜色/间距一律取自令牌、终端 ANSI 配色表除外；既有 19 套皮肤的用户已保存配置不能丢。

## Goals / Non-Goals

**Goals:**
- 令牌单一真相源，颜色/圆角/间距/字号/阴影/动效六类各有明确语义，组件只引用不定义
- 亮/暗双主题完整支持，Element Plus 在两套模式下均与系统令牌对齐
- 既有皮肤视觉可辨识地保留，且每个皮肤下派生出的整套槽位自洽
- 终端配色与主题联动，切换即时生效不打断会话
- 组件内颜色字面量清零（ANSI 调色板除外）

**Non-Goals:**
- 不做 A11 的第 3~6 项（布局导航、连接管理观感、微交互、终端细节）
- 不改业务逻辑与 IPC 接口契约（`Settings` 的主题字段调整属配置结构变更，见 Migration）
- 不引入 UI 框架或图表库；不引入构建期 CSS 预处理器
- 不做用户自定义圆角/字号等超出预设粒度的配置

## Decisions

### D1. 令牌源用 TypeScript，CSS 变量作为输出载体

**选择**：`src/renderer/src/theme/tokens.ts` 定义令牌（TS 常量 + 派生函数），运行时由 JS 计算后写入 `document.documentElement` 的内联 CSS 变量。

**理由**：三处刚性需求都指向 TS 侧——① 中性色需从预设背景色**程序化派生**（CSS 做不到）；② xterm 的 `Terminal.theme` 需要**具体色值对象**（CSS 变量在 canvas 渲染路径里取不到）；③ 派生规则需要**单测覆盖**。

**备选**：纯 CSS 变量 + 手写两套值 → 无法派生、xterm 拿不到值、派生规则无法测试；CSS 预处理器（Less/Sass）→ 引入构建依赖，派生逻辑仍需在 JS 侧再写一遍，反而双份实现。

### D2. 中性色由背景色程序化派生，而非逐皮肤手写

**选择**：`deriveSurface(baseBg, navColor)` 输入预设的背景色与导航色，输出一整套中性槽位（panel/card/fill/hover/border/borderStrong/text/text2/text3）。深浅由 `baseBg` 亮度判定：深色系向黑色方向混合提亮层级，浅色系向白色方向混合压暗层级。

**理由**：19 套皮肤 × 2 套中性色 = 38 份手写值，后续加皮肤必然漂移；而派生保证「任何底色下都有一套自洽的中性色」，且皮肤之间的个性（底色与导航色的色调差异）完全保留。

**备选 A**：19 套皮肤各手写固定中性色 → 维护成本随皮肤数线性增长，且新增皮肤必漂移。
**备选 B**：只保留固定 light/dark 两套中性色，预设只留强调色 → 19 套皮肤退化为 6 个强调色，失去辨识度，用户已保存的皮肤全部失效。

**配套**：`deriveSurface` 内置对比度保障——一级文字与背景的对比度低于阈值时，向更高对比方向继续调整，保证 WCAG AA 正文可读。

### D3. 用 `themeMode` 三态取代 `followSystemTheme` 布尔 + 隐式深浅推断

**选择**：新增 `themeMode: 'light' | 'dark' | 'system'`。

**理由**：现方案把「模式」隐含在背景色深浅里，用户改了强调色就可能连带改变模式，行为不可预测；三态显式表达用户意图，「跟随系统」也才有明确定义。旧布尔字段在读取时迁移：`followSystemTheme=true` → `system`；否则按当前背景色深浅 → `light`/`dark`。

**备选**：保留布尔字段、另加一个 `darkMode` 布尔 → 两个字段组合出 4 种状态，其中一种无意义，易出 bug。

### D4. 主题变更用 DOM 自定义事件广播给终端

**选择**：`applyTheme` 计算完令牌后 `window.dispatchEvent(new CustomEvent('tx-theme-change', { detail: tokens }))`；`TerminalView.vue` 监听该事件并设置 `term.options.theme`。

**理由**：终端组件无需依赖设置 store 或引入新的全局状态；事件携带已算好的令牌对象，订阅方无需重复计算；多个终端实例各自订阅，无中心协调者。

**备选**：Pinia 新增 `theme` store 存令牌 → 终端 watch store 变化。多一层状态与计算，且 `applyTheme` 本身是命令式的（由设置更新、启动加载等多处触发），二者易不同步。

### D5. Element Plus 变量由 JS 统一写入，CSS 只留兜底

**选择**：`applyTheme` 把 `--el-color-primary` 及其 3/5/7/8/9/-dark-2 阶、`--el-bg-color(-page/-overlay)`、`--el-border-color(-light/-lighter)`、`--el-fill-color(-light/-lighter)`、`--el-text-color-*`、`--el-mask-color` 全部写入；`base.css` 只保留一份「深色优先」的兜底声明，防止首帧闪白。

**理由**：令牌是运行时派生的，写两份必然漂移——这正是当前「浅色模式 Element Plus 用默认蓝」的成因。JS 侧写入是单一真相源。

### D6. 组件令牌化：连 `rgba()` 一并令牌化

**选择**：阴影色、遮罩色、强调色半透明底、浮层背景各自成为令牌（如 `--tx-shadow-color`、`--tx-overlay`、`--tx-accent-soft`），组件不再内联 `rgba(...)`。

**理由**：验收标准是「检索不到组件内颜色字面量」，`rgba()` 同样是字面量；且阴影/遮罩是双主题差异最大的部分，留在组件里必然有一半在浅色下违和。

## Risks / Trade-offs

- **派生色在极端底色下对比度不足** → `deriveSurface` 内置对比度校验与修正，低于阈值时向对比更强方向调整；单测覆盖深/浅两端与极端值
- **109 处硬编码清理引发视觉回归** → 按组件逐个改，每个组件改完跑对应单测；主题相关变更集中在一个提交，便于回退
- **浅色模式下界面强调色从组件库默认蓝变为用户强调色** → 属可见变化，但正是需求要修的问题；预设皮肤已按深/浅成对提供，浅色系预设（bright/snow）默认仍是绿色系
- **`themeMode` 是 `Settings` 的破坏性变更** → 旧配置读取时迁移，不删用户数据；`replace()`（备份恢复）同样走迁移
- **性能**：`applyTheme` 每次切换重算并写约 40 个 CSS 变量，开销可忽略；终端主题刷新为一次属性赋值

## Migration Plan

1. `Settings` 增加 `themeMode`、移除 `followSystemTheme`；`settingsStore.get()` 与 `replace()` 中把旧字段迁移为 `themeMode`
2. 新增 `theme/tokens.ts`（令牌定义 + 派生 + 对比度修正）与 `theme/xtermTheme.ts`（ANSI 调色板 + 搜索装饰）
3. 重写 `theme.ts` 为应用层：`resolveMode()` 判定模式 → `deriveSurface()` + 强调色阶 → 写令牌 → 写 EP 变量 → 广播事件
4. `base.css` 收敛为结构样式 + 兜底令牌
5. 逐组件替换硬编码色值（TerminalView → AiPanel → SettingsPanel → App.vue → ConnectionTable → SftpPanel → ConnectionFormDialog → ConnectionTree → CommandPalette）
6. 设置页主题分区新增外观模式选择；xterm 监听主题事件刷新配色
7. 回滚策略：以上均为渲染层与配置结构改动，若视觉验收不通过，可整体回退到本变更前提交；用户设置文件里的 `themeMode` 字段在回退后成为未知字段，被 `{...defaults, ...parsed}` 忽略，无副作用

## Open Questions

无。外观模式的取值集合（浅/深/跟随系统）、预设保留方式、终端联动方式均已在本设计中确定。
