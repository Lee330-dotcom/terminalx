# 应用安全

## ADDED Requirements

### Requirement: 凭据保护

密码与私钥内容 SHALL 使用 AES-256-GCM 加密后落盘。
加密密钥 SHALL 由 macOS keychain 生成并托管；凭据密文文件 SHALL NOT 包含解密密钥。
凭据 SHALL NOT 出现在日志、MCP 响应、IPC 消息中。

#### Scenario: 日志不含凭据

- **WHEN** 用户使用带密码的连接执行操作后检查应用日志
- **THEN** 日志中不出现明文密码或私钥内容

### Requirement: 渲染进程边界

渲染进程 SHALL 禁用 `nodeIntegration`，SHALL 通过 `contextBridge` 暴露类型安全的 IPC API。
渲染进程 SHALL NOT 直接访问文件系统或 ssh2 库。

#### Scenario: 渲染进程无 Node 能力

- **WHEN** 在渲染进程上下文中尝试访问 `require` 或 `process`
- **THEN** 不可用，仅能通过预定义的 IPC API 与主进程通信

### Requirement: MCP 暴露面

MCP HTTP 服务 SHALL 仅监听 127.0.0.1。
MCP 工具 SHALL 按连接 ID 引用目标服务器；任何响应 SHALL NOT 返回凭据。

#### Scenario: 外部主机无法访问

- **WHEN** 从局域网其他主机尝试访问 MCP 端口
- **THEN** 连接被拒绝
