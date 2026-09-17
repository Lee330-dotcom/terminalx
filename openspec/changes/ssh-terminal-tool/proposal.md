# SSH 连接工具（类 XTerminal，仅 SSH + MCP）

## 概述

构建一个 macOS 桌面应用：类似 XTerminal 但只保留 SSH 相关功能，并内置 MCP 服务器，让 AI 助手（如 Qoder）可以通过 MCP 协议连接服务器、执行命令、传输文件。

## 技术栈

- 桌面框架：Electron + Node.js（主进程）
- SSH：`ssh2` 库（连接池、PTY、SFTP 均在主进程）
- 前端：Vue 3 + TypeScript + Vite，终端渲染用 xterm.js
- MCP：主进程内起本地 HTTP 服务，Streamable HTTP 传输
- 存储：连接元数据存 JSON 文件；凭据 AES-256-GCM 加密存储，加密密钥存 macOS keychain
- 平台：仅 macOS（Apple Silicon）

## 总体架构

```
┌─────────────────────────────────────────────┐
│  Electron 主进程 (Node.js)                    │
│  ├─ 连接管理器: ssh2 Client 池、会话生命周期    │
│  ├─ SFTP 服务: ssh2 SFTP 通道                 │
│  ├─ MCP Server: 本地 HTTP + Streamable HTTP   │
│  └─ 凭据库: AES 加密存储 (keychain 密钥)       │
│       ↕ IPC (contextBridge, 类型安全)          │
│  ┌───────────────────────────────────────┐   │
│  │  渲染进程 (Vue 3 + TS + Vite)          │   │
│  │  ├─ 左侧栏: 连接列表/分组               │   │
│  │  ├─ 主区: xterm.js 终端标签页           │   │
│  │  └─ SFTP 面板: 文件树 + 上传下载        │   │
│  └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
        ↑ 外部 AI 客户端 (Qoder 等)
        └─ http://127.0.0.1:8080/mcp
```

**关键设计决策**：

1. **SSH 全部在主进程**：ssh2 连接池和终端 PTY 都在主进程，渲染进程只通过 IPC 收发数据。渲染进程不直接持有凭据。
2. **终端渲染用 xterm.js**：主进程的 ssh2 流通过 IPC 桥接给渲染进程的 xterm.js 显示，不需要 node-pty（ssh2 本身就是远程 PTY）。
3. **MCP server 在主进程内起 HTTP 服务**：监听 127.0.0.1，Streamable HTTP 传输，带本地 token 鉴权。
4. **连接信息与凭据分离存储**。

## 连接管理

- 连接配置字段：名称、分组、主机、端口、用户名、认证方式（密码 / 私钥）、备注、标签色。
- 分组支持两级树形结构（分组 → 连接），支持拖拽排序。
- `connections.json` 存元数据（不含密码），凭据单独加密存储。
- 不做 XTerminal 连接导入（YAGNI）。

## 终端会话

- 每个标签页 = 一个 SSH 会话。主进程为每个会话维护一个 `ssh2.Client` 实例，建立 shell PTY 通道（`TERM=xterm-256color`，窗口 resize 事件同步）。
- 数据流：SSH 输出流 → IPC → xterm.js 写入；用户按键 → xterm.js onData → IPC → SSH 输入流。
- 会话生命周期：断开/重连、复制粘贴（选区复制 + Cmd+V）、多标签页切换/关闭/新建。
- 意外断开时标签页显示"已断开"和"重新连接"按钮；不做自动重连。
- 心跳：应用层每 30s 发送 keepalive，连续失败判定断线。

**错误处理**：连接失败（超时、认证失败、主机不可达）在标签页内显示具体错误原因，区分"认证失败"和"网络不可达"。

## SFTP 文件传输

- 每个终端标签页可打开 SFTP 面板（左右分栏），展示远程目录树 + 文件列表（名称、大小、权限、修改时间）。
- 操作：上传（文件选择器 + 拖拽）、下载、新建文件夹、删除、重命名、双击预览文本文件。
- 复用同一 SSH 连接开启独立 SFTP 子通道（ssh2 `sftp()` API），不与终端 shell 通道互相干扰。
- 传输进度通过 IPC 推送（字节数/总字节数），支持取消；传输在后台队列执行。
- 所有路径拼接在主进程用 `path.posix` 处理，防止路径穿越。

## MCP Server

**传输与鉴权**

- 主进程启动 HTTP 服务，监听 `127.0.0.1:<port>`（默认 8080，可配置），端点 `/mcp`，Streamable HTTP 传输。
- 首次启动生成随机 token（存配置文件），MCP 请求必须带 `Authorization: Bearer <token>`。
- 界面显示接入 URL 和一键复制按钮，方便粘贴到 Qoder 等客户端配置。

**暴露的工具**

| 工具名 | 功能 |
|---|---|
| `list_connections` | 列出保存的连接（不含密码，含分组、主机、在线状态） |
| `exec_command` | 按连接 ID 执行命令，返回 stdout/stderr/exit code，支持超时参数 |
| `list_sessions` | 列出当前打开的终端会话（连接 ID、标签标题） |
| `read_terminal` | 读取指定会话的最近 N 行输出（会话滚动缓冲区） |
| `sftp_upload` / `sftp_download` | 文件上传/下载（文件大小上限 100MB） |
| `sftp_list` | 列出远程目录内容 |

**设计要点**

- AI 发起的 `exec_command` 走独立 SSH 连接上的 exec 通道，与交互终端隔离，输出回传 MCP 响应。
- 工具响应输出截断至 50KB，超限提示改用 `read_terminal` 或重定向。
- MCP server 可在界面设置中一键启停，默认开启。

## 安全

- 凭据（密码/私钥）用 AES-256-GCM 加密后落盘，加密密钥由 macOS keychain 生成并托管。
- MCP HTTP 仅监听 127.0.0.1，必须带 Bearer token；token 可在设置中重新生成。
- 渲染进程禁用 nodeIntegration，通过 contextBridge 暴露类型安全的 IPC API。
- MCP 工具均按连接 ID 引用目标服务器，凭据永不出现在 MCP 响应中。

## 测试策略

- **单元测试（Vitest）**：连接配置 CRUD、凭据加解密、路径穿越防护、MCP 工具的参数校验与输出截断。
- **集成测试**：用本地起一个临时 SSH 服务器（如 `ssh2` 自带的测试 server 或 Docker openssh-server）验证连接、exec 命令、SFTP 上传下载全链路。
- **端到端验证**：人工验证 UI 流程（建连接 → 开终端 → 拖拽上传），以及用真实 MCP 客户端（Qoder）接入调用工具。
- MCP 协议合规用官方 `@modelcontextprotocol/sdk` 编写，保证与各客户端互操作。

## 非目标（Non-goals）

- 不做会话日志/回放、跳板机/代理、命令片段库、主题市场。
- 不做 Windows/Linux 打包（代码保持可移植，但不验证）。
- 不做多用户/远程访问（MCP 仅本机）。
- 不做 MCP 客户端功能（本应用只作为 MCP server）。
