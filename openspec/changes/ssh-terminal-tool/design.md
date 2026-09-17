# 技术设计（design.md）

## Context

新项目，目录为空。目标：macOS 桌面应用（Electron + Vue 3 + TypeScript），核心是 SSH 终端 + SFTP + 内置 MCP server。动机与范围见 proposal.md。

约束：
- 仅 macOS（Apple Silicon），单用户本机应用。
- 用户环境网络访问 npm 官方源可能受限（参考 pip 镜像经验），Electron 二进制下载需配置镜像。
- SSH 全部在主进程完成，渲染进程无 Node 能力。

## Goals / Non-Goals

**Goals:**
- 一个 ssh2 Client 实例可同时承载 shell 通道与 SFTP 通道（按连接复用，减少握手）。
- MCP 工具与交互终端隔离：AI 执行命令不影响用户终端输出。
- 类型安全的 IPC 边界，凭据永不进入渲染进程或 MCP 响应。

**Non-Goals:**
- 不实现终端分屏、会话日志、跳板机（见 proposal 非目标）。
- 不做连接配置的多端同步/云备份。

## Decisions

### D1. 进程模型：SSH 全在主进程，渲染进程只做展示

- **决策**：主进程持有 `ssh2.Client` 池、PTY/SFTP 通道、MCP server；渲染进程通过 contextBridge 暴露的 `window.api` 收发消息。
- **备选**：渲染进程直接跑 ssh2（需开 nodeIntegration）→ 拒绝，违背 Electron 安全模型。
- **理由**：凭据只存在于主进程内存；MCP server 也天然在主进程，与连接池共享状态。

### D2. 终端渲染：ssh2 shell 流直连 xterm.js，不引入 node-pty

- **决策**：主进程把 shell 流的原始字节（Uint8Array）经 IPC 推给渲染进程，由 xterm.js 内置解码器处理 UTF-8 边界。
- **备选**：主进程先 decode 成字符串再推送 → 拒绝，多字节字符跨 chunk 时可能乱码；node-pty（本地 PTY）→ 不适用，ssh2 本身提供远程 PTY。
- **理由**：xterm.js 的解码器专为此设计，字节直传最可靠。

### D3. 连接复用：一个服务器一个底层 Client，多通道共享

- **决策**：`ConnectionManager` 按连接 ID 维护 `ssh2.Client`（引用计数）。终端会话开 shell 通道，SFTP 面板开 sftp 通道，MCP `exec_command` 开 exec 通道，全部复用同一 Client。无任何活跃通道时（引用计数归零）延迟关闭（如 60s 后销毁）。
- **备选**：每个 exec 命令新建临时连接 → 拒绝，重复握手慢且浪费；每会话一个 Client → 拒绝，同一服务器多标签页重复认证。
- **理由**：一次认证多用途，与 XTerminal 行为一致；延迟关闭避免频繁重连抖动。

### D4. 凭据加密：safeStorage 保护主密钥 + AES-256-GCM

- **决策**：首次启动生成 32 字节随机主密钥，用 Electron `safeStorage.encryptString` 加密后存 `master.key`；密码/私钥用主密钥做 AES-256-GCM 加密存 `credentials.enc`。
- **备选**：keytar 直接存每条密码 → 拒绝，keytar 已弃维护且有原生依赖；safeStorage 直接加密每条凭据 → 可用但每条独立密文，管理不变；纯软件加密无 keychain → 拒绝，密钥落盘等于没加密。
- **理由**：safeStorage 在 macOS 底层就是 Keychain 托管，无额外原生依赖；主密钥间接层便于将来轮换。

### D5. 数据存储：JSON 文件，不引入 SQLite

- **决策**：`userData` 目录下 `connections.json`（元数据）、`credentials.enc`（密文）、`settings.json`（MCP 端口/token 等）、`master.key`。
- **备选**：SQLite（better-sqlite3）→ 拒绝，连接数量规模小（几十条），原生依赖和迁移复杂度不值。
- **理由**：原子写入（写临时文件后 rename）即可满足一致性与崩溃安全。

### D6. MCP 传输：Streamable HTTP + Bearer token，基于官方 SDK

- **决策**：用 `@modelcontextprotocol/sdk` 的 `StreamableHTTPServer`，监听 `127.0.0.1:<port>`（默认 8080，`settings.json` 可改），端点 `/mcp`；首次启动生成 32 字节随机 token 存 settings，校验 `Authorization: Bearer <token>`。
- **备选**：stdio → 拒绝，常驻桌面应用不合适；旧版 HTTP+SSE 传输 → 拒绝，Streamable HTTP 是现行标准且 Qoder 支持；自定义 JSON-RPC 实现 → 拒绝，直接用 SDK 保证互操作。
- **理由**：官方 SDK 处理协议细节（初始化握手、消息解析），我们只写工具实现。

### D7. MCP 工具与连接池的关系

- **决策**：`exec_command` 优先复用已打开的 Client；无活跃连接时开临时 Client，命令结束即关闭。输出截断 50KB（按字节，保留头尾，中间标注）。`read_terminal` 读主进程维护的每会话环形滚动缓冲（10000 行上限）。
- **理由**：复用连接快；临时连接保证"AI 未开过终端的服务器"也能执行命令。

### D8. 前端组件与状态

- **决策**：Vue 3 + Vite + Element Plus（表单/树/对话框）+ Pinia（连接列表、会话标签状态）+ xterm.js（`@xterm/xterm` + `@xterm/addon-fit`）。IPC 类型在 `src/shared/` 共享目录定义，主/渲染进程共同引用。
- **理由**：Element Plus 是 Vue 3 生态最成熟的组件库，减少界面开发量；Pinia 管理跨标签页状态。

### D9. 心跳与断线判定

- **决策**：ssh2 自带 `keepaliveInterval: 30000`、`keepaliveCountMax: 3`，失败触发 close 事件 → 标签页置"已断开"态，提供手动重连。
- **理由**：用库能力而非自建心跳轮询，少一套状态机。

### D10. 测试策略落地

- **决策**：单元测试 Vitest（加密、路径归一化、MCP 参数校验/截断）；集成测试用 `ssh2` 自带的 `Server` 类在本机起临时 SSH 服务（随机端口、测试密钥对），验证连接、exec、SFTP 全链路，不依赖 Docker。
- **理由**：纯 npm 依赖即可跑集成测试，CI/本地一致。

## Risks / Trade-offs

- [Electron 二进制下载慢/失败] → 安装脚本用 npmmirror（`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）。
- [终端输出量大时 IPC 洪水] → 主进程按 16ms 窗口合并字节再推送；渲染层 xterm.write 本身高效。
- [safeStorage 在部分环境不可用（如无 Keychain 权限）] → 启动时检测，不可用则回退明文存储并显式警告（macOS 桌面环境正常不会触发）。
- [MCP 端口被占用] → 启动失败时界面提示并允许在设置中改端口后重启服务。
- [密码一旦忘记无法找回（加密存储）] → 接受，与 XTerminal 行为一致。
- [单 Client 多通道：shell 断线影响同连接 SFTP] → 通道级错误处理：shell 通道关闭仅置终端为已断开，sftp 通道仍可重试；Client 级断线才全部失效。

## Migration Plan

新应用，无迁移。首次发布路径：开发构建 → electron-builder 打 dmg → 本机安装验证 → 后续可加自动签名。

## Open Questions

- 应用正式名称与图标（占位 "SSH Tool"，不影响 specs 与任务拆分，打包前确定即可）。
