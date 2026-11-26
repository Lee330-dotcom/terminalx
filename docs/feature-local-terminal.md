# terminalX 功能需求文档：本地终端（Local Terminal）

> 版本：v1.0（2026-11-26）
> 目标读者：负责实现的开发 Agent
> 关联：主文档 `docs/feature-requirements.md` 的 A9（本地终端 / Serial / Telnet）——**本文档是 A9 第一阶段"本地终端"的详细拆解，Serial/Telnet 不在本文档范围**。

---

## 1. 背景与目标

terminalX 目前只能连接远程 SSH 主机。用户需要在不 SSH 的情况下直接使用本机 shell：macOS 上打开本机 zsh（Terminal.app 的"黑窗口"），Windows 上打开 cmd / PowerShell。

目标：在 terminalX 中以与 SSH 会话完全一致的体验打开本地 shell——同一个标签/分屏体系、同一个 xterm 渲染、同一套搜索/字体/主题。本功能落地后，A1 分屏体系中的 `sessionType: 'local'`（已在 A1 设计决策中预留）即被填上第一个非 SSH 类型。

## 2. 用户故事

1. 我在 macOS 上点"+ 新建本地终端"，立即得到一个本机 zsh 标签页，体验和 Terminal.app 一致。
2. 我在 Windows 上可以选择打开 cmd、PowerShell 或自定义 shell（如 Git Bash）。
3. 我可以把本地终端和 SSH 会话放进同一个分屏里左右对照。
4. 本地 shell 退出后（输入 `exit`），窗格提示会话已结束，我可关闭或重新打开。
5. 应用重启后本地终端不恢复（启动即干净，与 A1 决策一致）。

## 3. 功能需求

### FR1 本地会话类型与入口
- 新增会话类型 `local`（`sessionType: 'local'`），与 `ssh` 并列。
- 入口：
  - 连接树顶部"+"菜单增加"新建本地终端"；
  - 命令面板（`CommandPalette.vue`）支持"新建本地终端"命令；
  - A1 分屏的空窗格连接选择器中可选本地终端。
- **不**进入连接树/连接表单——本地终端不存储为"连接配置"，属即时打开的轻量会话（与 SSH 会话的管理方式区分）。

### FR2 Shell 发现与默认值（按平台）
| 平台 | 默认 | 探测顺序 |
| --- | --- | --- |
| macOS | `$SHELL` 环境变量指向的 shell（通常 zsh） | `$SHELL` → `/bin/zsh` → `/bin/bash` |
| Windows | cmd.exe | `cmd.exe` → `powershell.exe`（ConPTY） |
| Linux | `$SHELL` | `$SHELL` → `/bin/bash` |
- Windows 额外探测 PowerShell、Git Bash（`<git>/bin/bash.exe`）并列入可选列表；macOS/Linux 列出 `/etc/shells` 中的 shell。
- 探测失败时允许用户手动指定可执行文件路径。

### FR3 Shell Profile 配置
- 设置面板（`SettingsPanel.vue`）新增"本地终端"分区：
  - 默认 shell（从 FR2 探测列表中选择或手动填路径）；
  - 启动参数（args，字符串数组）；
  - 启动目录（cwd，默认用户 Home）；
  - 附加环境变量（键值对）。
- 配置持久化到 `settingsStore.ts`，多 profile 支持（命名 profile，下拉切换）。
- Profile 中的路径/环境变量为本地明文配置（非凭据，不进 `credentialVault`），但不得包含密码类敏感项的提示文案。

### FR4 PTY 生命周期（主进程）
- 使用 `node-pty`（或同等 PTY 库）在 **main 进程** spawn 本地 shell；渲染进程只经 IPC 读写数据流，**渲染进程不直接持有 PTY 句柄**。
- 实现要点：
  - `write(data)`：键盘输入写入 PTY；`resize(cols, rows)`：跟随窗格/xterm 尺寸（`fit` addon 计算后同步），与 SSH 会话的 resize 链路对齐；
  - 退出检测：进程退出事件 → 通知渲染层显示"会话已结束"覆盖层（按钮：关闭窗格 / 重新打开同 profile）；**禁止**自动重启 shell；
  - 应用退出/标签关闭时向 shell 发送退出信号并回收，防止僵尸 PTY（macOS/Linux 需 kill 进程组，Windows 需 terminate ConPTY）；
  - 同一会话断开 UI（如窗格关闭）后 PTY 必须被销毁，不允许无 UI 的后台 PTY 存活。
- 建议新增 `src/main/ssh/localShellService.ts`（或 `src/main/local/localShellService.ts`，与 SSH 目录解耦亦可），接口形状与 `sessionManager.ts` 的会话抽象对齐（`onData/onExit/write/resize/kill`），使 A1 布局容器无需感知差异。

### FR5 渲染与交互（与 SSH 一致）
- 复用 xterm.js 渲染链路：同一套字体/行高/光标配置、`addon-fit`、`addon-search`、A11 主题联动（亮/暗 ANSI 配色一致生效）。
- 本地终端与 SSH 终端在 UI 上通过徽标区分（如标签上 "Local" 小标签），避免用户误把本机命令当远程执行。
- 复制粘贴、滚动缓冲区行为与 SSH 终端一致。

### FR6 边界与降级
- `node-pty` 原生模块加载失败（ABI 不匹配等）：UI 明确报错并指引重新安装，**不得**影响 SSH 主链路（SSH 功能在异常时仍可用）。
- shell 路径非法/无法启动：窗格内展示错误信息与"修改 profile"入口。
- 本地终端**不**纳入 AI Agent 与 MCP Server 的工具范围（`exec_command`、`read_terminal` 等仍仅针对 SSH 主机）——本轮明确排除，防止本地 shell 被外部 Agent 驱动的安全面扩大。后续如需支持另立文档评审。

## 4. 技术方案要点

1. **依赖**：`node-pty`（Electron 官方生态事实标准）。它是原生模块，需加入 `electron-builder.yml` 的 asarUnpack，并确认 `postinstall` 的 `electron-builder install-app-deps` 能为 Electron ABI 重编（现有 ssh2 的 allowScripts 模式可参考，package.json `allowScripts` 需加 `node-pty`）。若 `node-pty` 在本机构建受阻，备选 `@lydell/node-pty`（预编译二进制）。
2. **Windows ConPTY**：node-pty 在 Windows 走 ConPTY，注意 win10 1809+ 以下版本降级 winpty 的兼容提示（可直接声明仅支持 ConPTY，报错即止）。
3. **IPC 通道**：沿用 `src/main/ipc.ts` + `src/preload/` 模式新增 local shell 通道（open/write/resize/exit/data），命名与现有 SSH 通道风格一致；大数据流经现有 SSH 数据流同款的通道节流策略。
4. **类型**：`src/shared/types` 新增 `LocalShellProfile`、`LocalShellSessionInfo` 等，`sessionType` 联合类型扩展为 `'ssh' | 'local'`。
5. **会话计数**：`list_sessions`（MCP）与"活跃会话"统计语义保持不变——只统计 SSH 会话，本地终端不计入（本轮范围决定）。

## 5. 非功能需求

- **性能**：本地终端打开延迟 < 300ms（不含 shell 自身启动）；`ls -R /` 类高吞吐输出不卡 UI（与 SSH 同款节流/批量 flush）。
- **安全**：PTY 只在 main 进程；渲染进程无 spawn 能力；本地终端不暴露给 MCP/AI（FR6）。
- **i18n**：所有新文案进 `src/renderer/src/i18n.ts`（"新建本地终端"、"会话已结束"、"默认 Shell" 等）。
- **跨平台**：macOS / Windows / Linux 三端打包产物均需验证。

## 6. 测试与验收标准

1. **单测（Vitest）**：shell 探测逻辑（mock `$SHELL`/`/etc/shells`/Windows 注册表探测）、profile 存取、PTY 生命周期状态机（exit → 覆盖层 → 销毁）在 mock pty 下全覆盖；主进程服务放 `__tests__/`，风格对齐现有测试。
2. **E2E/手动验证**：按 `src/e2e/verify-*.manual.ts` 模式新增 `verify-local-shell.manual.ts`，覆盖三平台打包产物：打开本地终端 → 执行 `echo $0`（win: `echo %CD%`）→ resize 窗格输出对齐 → `exit` → 覆盖层 → 重新打开。
3. **验收清单**：
   - [ ] macOS 打开默认 zsh，提示符正常、色彩/鼠标事件（vim、htop 类 TUI）正常；
   - [ ] Windows 打开 cmd 与 PowerShell，ConPTY 下 TUI 程序（如 `winget`）渲染正常；
   - [ ] 本地终端与 SSH 会话同标签分屏共存，resize 互不影响；
   - [ ] `exit` 后出现"会话已结束"覆盖层，重开/关闭均正常，无僵尸进程（`ps` 查不到残留 shell）；
   - [ ] 修改默认 shell profile 后新开的本地终端生效；
   - [ ] 主题切换（M0 令牌体系）下本地终端配色随主题联动；
   - [ ] 标签带 "Local" 徽标，与 SSH 会话可区分；
   - [ ] MCP `list_sessions`/`exec_command` 行为不变（不含本地终端）。

## 7. 范围外（明确不做）

- Serial / Telnet / Mosh（A9 其余部分，另立需求）；
- 本地终端的布局持久化/重启恢复（与 A1 决策一致：启动即干净）；
- 本地终端接入 AI Agent / MCP 工具面（FR6，另行安全评审）；
- Windows WSL 发行版管理（如探测到 `wsl.exe` 可作为普通 profile 手动配置，不做专门 UI）。
