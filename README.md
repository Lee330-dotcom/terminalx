# terminalX

基于 Electron + Vue 3 的 SSH 桌面客户端，内置终端、SFTP 文件管理、AI 助手与 MCP Server。

## 功能特性

### SSH 终端
- 基于 [ssh2](https://github.com/mscdex/ssh2) + [xterm.js](https://xtermjs.org/) 的交互式终端，支持搜索（`@xterm/addon-search`）与自适应布局（`@xterm/addon-fit`）
- 连接管理：连接树/列表、延迟探测、自动重连
- 凭据安全存储：主密钥由 Electron safeStorage（macOS 上为 Keychain）托管，各凭据使用 AES-256-GCM 加密落盘（`src/main/store/credentialVault.ts`）

### SFTP 文件管理
- 远程文件浏览、上传、下载（`src/main/ssh/sftpService.ts`）

### AI 助手
- 内置 Agent，支持工具调用（Tool Calling），可读取终端会话、在远程主机上执行命令
- 命令策略管控（`src/main/ai/commandPolicy.ts`）：高危命令需人工审批后才会执行
- 输出截断保护：单次命令输出 50KB 预算，stdout/stderr 保留头尾、中间省略

### 内置 MCP Server
应用内启动一个 MCP（Model Context Protocol）HTTP 服务（Streamable HTTP Transport），供外部 AI 工具接入，暴露以下工具：

| 工具 | 说明 |
| --- | --- |
| `list_connections` | 列出已配置的 SSH 连接 |
| `list_sessions` | 列出当前活跃会话 |
| `exec_command` | 在远程主机执行命令 |
| `read_terminal` | 读取终端当前输出 |
| `sftp_list` | 列出远程目录 |
| `sftp_upload` | 上传文件到远程主机 |
| `sftp_download` | 从远程主机下载文件 |

## 技术栈

- **框架**：Electron + electron-vite + Vue 3 + TypeScript
- **UI**：Element Plus + Pinia
- **核心依赖**：ssh2、@xterm/xterm、@modelcontextprotocol/sdk
- **测试**：Vitest（单元测试 + E2E）

## 项目结构

```
src/
├── main/        # Electron 主进程
│   ├── ai/      # AI Agent 服务、命令策略、提示词
│   ├── mcp/     # 内置 MCP Server
│   ├── ssh/     # SSH 连接管理、会话管理、SFTP、延迟探测
│   └── store/   # 连接配置、凭据库、设置存储
├── preload/     # 预加载脚本
├── renderer/    # 渲染进程（Vue 3 + Element Plus）
├── e2e/         # E2E 测试与打包产物手动验证脚本
└── shared/      # 主/渲染进程共享类型
```

## 快速开始

### 环境要求

- Node.js ≥ 20
- npm

### 安装

```bash
$ npm install
```

### 开发

```bash
$ npm run dev
```

### 测试

```bash
# 单元测试
$ npm test

# 监听模式
$ npm run test:watch

# E2E 测试（先构建再跑）
$ npm run test:e2e
```

### 代码检查与类型检查

```bash
$ npm run lint
$ npm run typecheck
```

### 打包构建

```bash
# Windows
$ npm run build:win

# macOS（产出 dmg）
$ npm run build:mac

# Linux
$ npm run build:linux

# 仅构建、不打包安装包（用于本地验证）
$ npm run build:unpack
```

打包产物手动验证脚本见 `src/e2e/verify-*.manual.ts`（覆盖 dmg、MCP、设置、UI）。

## License

MIT
