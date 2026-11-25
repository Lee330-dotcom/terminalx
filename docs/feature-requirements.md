# terminalX 功能需求文档

> 版本：v1.0（2026-11-25）
> 目标读者：负责实现的开发 Agent
> 定位：基于现有代码库演进为 **"安全可审计的 AI 运维工作台"**

---

## 1. 背景与定位

terminalX 是基于 Electron + Vue 3 的 SSH 桌面客户端，已具备：SSH 终端（ssh2 + xterm.js）、SFTP 文件管理、AI Agent（工具调用 + 高危命令审批）、内置 MCP Server（7 个工具）、凭据加密库（Electron safeStorage + AES-256-GCM）。

对标 Termius、Warp、Tabby、WindTerm、FinalShell、SecureCRT、iTerm2、Conduit、Termalin 后，差异化打法确定为三个字：**安全、可审计、AI 原生**——凭据不出库、高危必审批、全程可回放。这三点是 Warp（无主机管理）和 Termius（AI 浅、按月付费）都没占住的位置。

**三大类需求：**
- **A 类：补齐业内标配**（不做用户第一眼就流失）
- **B 类：放大现有优势**（AI + MCP 护城河）
- **C 类：差异化亮点**（发布卖点）

---

## 2. 现有代码基线（实现前必读）

| 模块 | 关键路径 | 说明 |
| --- | --- | --- |
| SSH 连接/会话 | `src/main/ssh/connectionManager.ts`、`sessionManager.ts`、`config.ts`、`latencyProbe.ts` | 连接树、延迟探测、自动重连 |
| SFTP | `src/main/ssh/sftpService.ts` | 浏览/上传/下载 |
| AI | `src/main/ai/agentService.ts`、`aiService.ts`、`commandPolicy.ts`、`prompts.ts` | Agent、命令策略（`evaluateCommand` 返回 `auto/confirm/reject`）、单命令输出 50KB 截断预算 |
| MCP Server | `src/main/mcp/mcpService.ts` | Streamable HTTP Transport，工具：`list_connections`/`list_sessions`/`exec_command`/`read_terminal`/`sftp_list`/`sftp_upload`/`sftp_download`；支持按名禁用工具 |
| 凭据库 | `src/main/store/credentialVault.ts` | 主密钥由 safeStorage 托管，AES-256-GCM 落盘 |
| 其他存储 | `src/main/store/connectionStore.ts`、`settingsStore.ts`、`jsonFile.ts` | 连接配置、设置 |
| 渲染层 | `src/renderer/src/components/`：`TerminalView.vue`、`ConnectionTree.vue`、`SftpPanel.vue`、`AiPanel.vue`、`CommandPalette.vue`、`SettingsPanel.vue`、`ImportDialog.vue`、`ConnectionTable.vue` | Vue 3 + Element Plus + Pinia |
| 共享类型 | `src/shared/types` | 主/渲染进程共享 |
| IPC | `src/main/ipc.ts`、`src/preload/` | 通道定义 |
| 测试 | Vitest 单测（各模块 `__tests__/`）+ `src/e2e/`（含 `verify-*.manual.ts` 打包产物手动验证） | 新功能须配套单测 |

约定：新功能遵循现有分层（main 进程服务 + IPC + preload 暴露 + renderer 组件），凭据一律走 `credentialVault`，不落明文；每个功能须附带 Vitest 单测；UI 文案走 `src/renderer/src/i18n.ts`。

---

## 3. A 类：补齐业内标配（P0~P1）

### A1. 多标签 + 分屏终端（P0）
- **需求**：主窗口支持多标签页打开多个 SSH 会话；单个标签内支持 2×2 以内的分屏（水平/垂直分割），分屏可独立切换不同会话，可拖拽调整比例。
- **对标**：Tabby、iTerm2、Termius。
- **验收**：≥10 个标签流畅切换；分屏内会话互不串扰；关闭最后一个分屏自动关标签；断线重连保持分屏布局。
- **涉及**：`TerminalView.vue` 重构为布局容器 + 终端叶子组件；`sessionManager.ts` 支持多会话并存。

### A2. Snippet / 快捷命令（P0）
- **需求**：本地管理常用命令（名称 + 命令 + 可选参数模板 `{var}`，执行时弹窗填参）；在命令面板（`CommandPalette.vue`）和终端右键菜单中可一键下发到当前会话；支持按文件夹分组。
- **对标**：Termius Snippets、FinalShell 快捷命令。
- **验收**：新建/编辑/分组/搜索；参数模板占位符替换后确认执行；与命令面板搜索打通。
- **涉及**：新增 `src/main/store/snippetStore.ts` + renderer 管理界面。

### A3. 端口转发 / 隧道管理 + 跳板链（P0）
- **需求**：
  1. 本地转发（-L）、远程转发（-R）、动态转发 SOCKS5（-D）三种隧道，可视化创建、启停、状态显示（监听端口、流量）。
  2. 连接支持配置跳板机链（ProxyJump 等价）：经多级 SSH 中转连接目标主机，跳板凭据从凭据库取。
- **对标**：Termius Port Forwarding、SecureCRT。**理由**：堡垒机/跳板场景刚需。
- **验收**：ssh2 的 `forwardOut/forwardIn` 实现；隧道断线自动重连并可配置；跳板链 ≥2 级可用。
- **涉及**：`connectionManager.ts` 扩展、新增 `tunnelService.ts`、`ConnectionFormDialog.vue` 增加表单。

### A4. known_hosts 主机指纹校验（P0，安全短板）
- **需求**：首次连接展示主机指纹（host key SHA256）供用户确认；持久化存储；后续连接指纹变更时强告警（醒目提示疑似中间人攻击，需用户显式确认才可继续）。
- **验收**：指纹持久化（复用 `jsonFile.ts` 模式）；变更告警不可绕过；支持 OpenSSH known_hosts 格式导入。
- **涉及**：`connectionManager.ts` 的 host key 校验回调 + 新增 `hostKeyStore.ts`。

### A5. 服务器监控面板（P1）
- **需求**：连接会话侧栏展示实时资源图表（CPU、内存、磁盘、网络 IO），默认 5s 刷新可调；数据采集通过 SSH 执行轻量命令（如读取 `/proc`，不要求目标机安装 agent）。
- **对标**：FinalShell、WindTerm、Termalin live stats。**理由**：运维粘性最高的功能。
- **验收**：≥4 项指标图表化（折线）；采集失败静默降级不影响终端；采集命令输出走截断预算。
- **涉及**：新增 `src/main/ssh/metricsService.ts` + renderer 图表组件（ECharts 或轻量 SVG）。

### A6. SFTP 增强（P1）
- **需求**：
  1. 双栏视图（本地 ↔ 远程）拖拽传输；
  2. 传输队列（并行可配、暂停/取消、失败重试）；
  3. 断点续传（大文件）；
  4. 远程文件内置编辑器（打开→编辑→保存回写，保存前自动备份原文件）；
  5. 目录大小统计、文件搜索。
- **对标**：Termius SFTP、Termalin 内置编辑器。
- **验收**：100MB+ 文件断网续传成功；编辑保存原子写入（临时文件 + rename）。
- **涉及**：`sftpService.ts` 扩展、`SftpPanel.vue` 重构。

### A7. rz/sz（Zmodem）（P1）
- **需求**：终端内识别 ZMODEM 起始帧（`rz`/`sz`），弹出文件选择/保存对话框并走 SFTP 通道传输，传输进度在终端内显示。
- **对标**：FinalShell 招牌体验、SecureCRT。
- **验收**：与常见 lrzsz 互通；传输中终端输入挂起、结束后恢复。
- **涉及**：xterm 数据流解析（可用 zmodem.js 或自实现 ZDLE 协议帧）。

### A8. 会话日志与录制回放（P1，可审计的地基）
- **需求**：
  1. 会话输出级录制：记录时间戳 + 输出块（不含用户输入的敏感内容可选脱敏），本地加密存储；
  2. 会话日志文件（可选开启，纯文本 apppend）；
  3. 回放器：按时间轴拖动回放输出。
- **对标**：Termalin 输出级录制、asciinema。**理由**：为 C 类"会话 AI 摘要"和"审计"打地基。
- **验收**：录制文件 AES-256-GCM 加密落盘（复用 `credentialVault` 的加密原语）；回放流畅；可导出 asciinema v2 格式。
- **涉及**：`sessionManager.ts` 挂钩数据流、新增 `sessionRecorder.ts`。

### A9. 本地终端 / Serial / Telnet（P2）
- **需求**：本地 shell（node-pty）标签；Serial（serialport）与 Telnet 连接类型接入现有连接树。
- **对标**：Tabby、SecureCRT。
- **验收**：与 SSH 会话在同一标签/分屏体系内无差别使用。
- **依赖**：A1 完成后实施。

### A10. 输入广播（P2）
- **需求**：多选会话后开启广播模式，键盘输入同步下发到所有选中会话（iTerm2 broadcast input），广播时终端角标醒目提示。
- **验收**：可随时退出；广播会话有视觉标识防止误操作。

### A11. 整体 UI 风格升级（对标 Termius）（P1）
- **需求**：全面重设计视觉层，达到 Termius 级别的现代观感，覆盖暗色/亮色两套主题。具体要求：
  1. **设计令牌（Design Tokens）**：建立统一的设计变量体系（色彩、圆角、间距、字号、阴影），沉淀到 `src/renderer/src/theme.ts` 与全局 CSS 变量，Element Plus 主题变量与其对齐；主色、强调色、成功/警告/危险语义色成体系，禁止组件内散落硬编码色值。
  2. **暗色/亮色主题**：双主题完整支持，跟随系统并可手动切换；终端配色（xterm ANSI 16 色）随主题联动，暗色下对比度达 WCAG AA。
  3. **布局与导航**：左侧边栏（连接树）+ 主工作区的现代布局，连接树项带主机在线状态圆点、协议/标签小徽标；主区顶部面包屑/标签栏精致化（悬浮态、激活态、关闭按钮 hover 才显示等细节）。
  4. **连接管理观感**：连接表单对话框重设计为分组卡片式布局；连接列表支持卡片视图（主机名、地址、标签、延迟徽章），替代密集表格观感。
  5. **微交互与细节**：按钮/卡片 hover 过渡（150~200ms ease）、连接中 spinner、SFTP 传输进度条、空状态插画/引导文案、Toast 统一样式；关键面板（终端、SFTP、AI）切换带轻量过渡动画，不卡顿。
  6. **终端体验细节**：字体可选（内置等宽字体推荐集）、行高/光标样式可配、终端内右键菜单样式统一。
- **对标**：Termius（整体质感）、Tabby（主题体系）、iTerm2（终端可配性）。
- **验收**：
  - 暗色/亮色两套主题下全部页面无样式破损、无刺眼违和色；截图走查通过；
  - 所有颜色/间距均取自设计令牌，`grep` 不到组件内硬编码色值（终端 ANSI 配色表除外）；
  - 主题切换即时生效、无需重启；
  - 1920×1080 与 2560×1440 下布局无错位；侧栏可收起。
- **涉及**：`src/renderer/src/theme.ts` 重构为设计令牌源、全局样式重构、逐组件改造（`ConnectionTree.vue`、`ConnectionTable.vue`、`ConnectionFormDialog.vue`、`SettingsPanel.vue`、`SftpPanel.vue`、`AiPanel.vue`、`TerminalView.vue`）、xterm 主题对象联动。
- **约束**：纯视觉层改造，不改业务逻辑与 IPC 接口；改造分组件小步提交，每个组件改造后跑通对应单测。

---

## 4. B 类：放大现有优势（AI + MCP，P0~P1）

### B1. 密钥托管式 MCP（Key Custodian）（P0，核心卖点）
- **需求**：外部 AI Agent 通过内置 MCP Server 操作主机时，**永远拿不到 SSH 凭据**——所有认证由 terminalX 主进程代理完成；MCP 层新增会话实时可见能力：
  1. "Agent 会话网格"：应用内实时展示每个外部 Agent 当前连接的主机、正在执行的命令、输出流；
  2. 每次 MCP `exec_command` 记录审计条目（调用方、主机、命令、时间、结果摘要）；
  3. 支持 per-connection 授权：用户可选择哪些主机对 MCP 开放。
- **对标**：Termalin key custodian（Agent 不见密钥 + 应用内实时观看）。
- **验收**：抓包/日志验证凭据零泄露；未授权主机对 MCP 不可见；网格视图实时刷新。
- **涉及**：`mcpService.ts`、`credentialVault.ts`、新增 Agent 会话网格组件。

### B2. AI 故障诊断闭环（P0，招牌体验）
- **需求**：一键"让 AI 看看"：AI 读取当前终端上下文（滚动缓冲区）→ 解释报错根因 → 生成修复命令 → 以 diff/命令卡片形式展示 → 用户点击批准后经 `commandPolicy` 审批执行 → 展示执行结果并自动追加下一步建议（直到问题解决或用户中止）。
- **对标**：Warp AI，但 terminalX 做在**远程主机**上（Warp 做不了）。
- **验收**：完整闭环 ≤3 次交互；每一步执行均过 `evaluateCommand`（`auto/confirm/reject`）策略；上下文发送前支持脱敏预览。
- **涉及**：`agentService.ts` 新增诊断工作流 + `TerminalView.vue`/`AiPanel.vue` 交互卡片。

### B3. 自然语言 SFTP（P1）
- **需求**：在 SFTP 面板提供自然语言输入框，AI 编排 `sftp_list`/`sftp_upload`/`sftp_download`/`exec_command` 工具完成任务，例如"把这个目录下 7 天前的 .log 打包下载到本地"。执行计划先展示后执行，涉及删除类操作强制确认。
- **验收**：至少正确编排 2~4 步的任务；删除/覆盖类操作有独立确认关卡。
- **依赖**：复用 B2 的工作流框架。

### B4. 会话 AI 摘要（P1）
- **需求**：基于 A8 的会话录制，一键生成"本次会话摘要"：做了什么、执行了哪些关键命令、改了哪些配置文件、风险点提示；可导出为 Markdown 变更记录。
- **验收**：摘要基于本地录制数据，无需重放命令；导出文件可归档。
- **依赖**：A8。

### B5. 命令风险策略自学习（P1）
- **需求**：从用户历史审批结果沉淀 allowlist（如"该用户总是批准 systemctl status"），后续同类命令自动升级为 `auto`；allowlist 可在设置中查看/编辑/清空；学习规则透明可解释（展示"因为过去 N 次你批准了 X"）。
- **验收**：`commandPolicy.ts` 扩展为策略上下文（含用户配置）驱动；高危模式（`rm -rf`、`dd`、`:(){ :|:& };:` 等）永不自动放行。
- **涉及**：`commandPolicy.ts`、`settingsStore.ts`、`AiPanel.vue`。

### B6. 多主机批量 AI 运维（P1）
- **需求**：连接树多选主机（或按分组）→ 输入一句话任务 → AI 生成执行计划 → 用户审批 → 并行下发（并发数可配）→ 汇总各主机结果为对比表格，失败主机可单独重试。
- **对标**：pssh / Ansible ad-hoc，但带审批闸门与 AI 计划。
- **验收**：≥10 台主机并发稳定；单台失败不阻塞其他；结果表格支持导出 CSV。
- **依赖**：复用 B2 框架与 A1 多会话。

---

## 5. C 类：差异化亮点（发布卖点，P2）

### C1. MCP 双向：terminalX 作为 MCP Client
- **需求**：`AiPanel.vue` 支持挂载用户自定义 MCP Server（stdio/HTTP），AI 工具列表动态合并（内置工具 + 外部 MCP 工具）；外部工具调用同样受审批闸门管控。典型场景：AI 直接查数据库、操作 Jira、查云控制台。
- **验收**：可配置 ≥3 个外部 MCP Server 并在对话中调用；工具调用有审批与审计。
- **涉及**：`@modelcontextprotocol/sdk` client 能力、`settingsStore.ts` 增加配置页。

### C2. 远程托管 MCP 接入
- **需求**：提供云端（或自托管）MCP 入口，claude.ai / ChatGPT 等外部 Agent 在桌面端不运行时也能操作已注册主机；连接凭据仍不出终端本地（云侧仅做路由与转发，密钥托管语义同 B1）。配对流程：桌面端生成配对码 → 云端绑定。
- **验收**：桌面端离线时云端明确拒绝；所有云端转发会话在桌面端下次打开时补看审计记录。
- **说明**：需要服务端组件，建议独立立项，先出技术方案评审。

### C3. Runbook 自动生成
- **需求**：从会话录制历史反向生成可复用脚本/Snippet：AI 提炼重复操作序列 → 生成带参数模板的 Snippet（落到 A2 的 Snippet 库）或 Shell 脚本文件；支持"这周我手动做了 3 遍的事帮我沉淀下来"类提示。
- **依赖**：A8 + A2 + B4。

### C4. 团队共享凭据库（E2E 加密同步）
- **需求**：团队版功能——凭据/连接/Snippet 跨设备端到端加密同步，服务端只存密文；按组授权（某组只见某组主机）；同步冲突以设备时间戳最后写入为准并保留历史版本。
- **对标**：Termius 团队版（$10/月/人），开源产品几乎没有做好这块。
- **验收**：服务端数据库泄漏时凭据不可解密；成员移除后其设备立即失效（密钥轮换）。
- **说明**：需服务端组件与密钥协商协议设计（建议 libsodium sealed box / 每组对称密钥 + 成员公钥封装），独立立项评审。

---

## 6. 实施顺序与里程碑建议

| 里程碑 | 内容 | 说明 |
| --- | --- | --- |
| **M0（UI 基座，与 M1 并行）** | A11 中的 1、2 项：设计令牌体系 + 暗色/亮色主题 | 先立地基，后续所有新组件直接用令牌开发，避免二次返工 |
| **M1（先补齐，保住第一眼）** | A1 分屏多标签 → A4 known_hosts → A2 Snippet → A3 端口转发/跳板链 | 全部 P0；A1 是后续 A9/A10/B6 的地基 |
| **M2（放大优势，做传播点）** | B1 密钥托管 MCP → B2 AI 故障诊断闭环 → A5 监控面板 | 三大拉新转发点 |
| **M3（体验补全）** | A11 其余项（3~6：布局导航/连接管理/微交互/终端细节）→ A6 SFTP 增强 → A7 rz/sz → A8 会话录制 → B3/B4/B5 | 可审计地基成型；UI 全量改造排在 M0 令牌就绪之后 |
| **M4（亮点故事）** | C1 MCP Client → B6 批量 AI 运维 → A9/A10 → C3 Runbook | "AI 运维工作台"完整故事 |
| **M5（平台化）** | C2 远程托管 MCP、C4 团队共享凭据库 | 各需服务端，独立技术评审后立项 |

依赖关系备忘：B3/B4 依赖 B2 工作流框架；B4/C3 依赖 A8；A9/A10 依赖 A1；C3 依赖 A2+A8+B4。

## 7. 全局约束（每个功能必须遵守）

1. **凭据安全**：任何凭据只经 `credentialVault` 加密存取，日志/审计/摘要中严禁出现明文密码与私钥。
2. **审批闸门**：所有会执行命令的功能（AI、MCP、批量运维）必须经过 `commandPolicy`；高危模式（递归删除、磁盘写入、防火墙变更等）永不静默放行。
3. **输出预算**：所有命令输出经截断预算（现有 50KB 头尾保留策略，见 `mcpService.ts#truncateExecOutput`），避免撑爆上下文。
4. **可测试**：main 进程新服务必须有 Vitest 单测（参考各 `__tests__/` 风格）；E2E 打包产物验证脚本补到 `src/e2e/verify-*.manual.ts`。
5. **i18n**：UI 文案进 `src/renderer/src/i18n.ts`，不硬编码中文。
6. **设计令牌**：所有 UI 开发（含新增组件）颜色/间距/圆角/字号一律取自 `theme.ts` 设计令牌与全局 CSS 变量，禁止硬编码色值（终端 ANSI 配色表除外），暗色/亮色主题均需走查。
7. **降级容忍**：依赖目标机环境的功能（监控采集、rz/sz）失败时静默降级，不影响终端主链路。
