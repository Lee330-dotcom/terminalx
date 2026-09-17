# MCP 服务器

## ADDED Requirements

### Requirement: 服务与鉴权

应用 SHALL 在主进程启动 HTTP 服务，监听 `127.0.0.1:<port>`（默认 8080，可配置），端点 `/mcp`，采用 MCP Streamable HTTP 传输。
首次启动 SHALL 生成随机 token 并持久化；MCP 请求 SHALL 携带 `Authorization: Bearer <token>`，校验失败返回 401。
界面 SHALL 显示接入 URL 并提供一键复制；token SHALL 可在设置中重新生成。MCP 服务 SHALL 可在设置中启停，默认开启。

#### Scenario: 未授权请求被拒绝

- **WHEN** 客户端不带 token 或带错误 token 请求 `/mcp`
- **THEN** 服务返回 401，不暴露任何工具信息

#### Scenario: 重新生成 token

- **WHEN** 用户在设置中重新生成 token
- **THEN** 旧 token 立即失效，界面显示新 token

### Requirement: list_connections 工具

`list_connections` SHALL 返回保存的连接列表（名称、分组、主机、在线状态），SHALL NOT 包含任何凭据。

#### Scenario: 凭据不泄露

- **WHEN** MCP 客户端调用 `list_connections`
- **THEN** 响应中不含密码、私钥或 token 字段

### Requirement: exec_command 工具

`exec_command` SHALL 按连接 ID 执行命令，返回 stdout/stderr/exit code，支持超时参数；命令在独立 exec 通道运行，不影响交互终端会话。

#### Scenario: AI 执行命令不影响交互终端

- **WHEN** MCP 客户端对某连接调用 `exec_command` 执行命令
- **THEN** 返回命令输出与 exit code，且该连接上已打开的交互终端无任何输出干扰

#### Scenario: 命令输出截断

- **WHEN** `exec_command` 的输出超过 50KB
- **THEN** 响应被截断并附带截断标记，提示可重定向或使用 `read_terminal`

### Requirement: 会话读取工具

`list_sessions` SHALL 返回当前打开的终端会话（连接 ID、标签标题）。
`read_terminal` SHALL 返回指定会话滚动缓冲区的最近 N 行输出。

#### Scenario: 读取终端输出

- **WHEN** MCP 客户端对某个打开的会话调用 `read_terminal` 指定行数 N
- **THEN** 返回该会话缓冲区的最近 N 行文本

### Requirement: SFTP 工具

`sftp_upload` / `sftp_download` SHALL 支持文件上传/下载，文件大小上限 100MB，超限拒绝。
`sftp_list` SHALL 返回远程目录内容列表。

#### Scenario: 超大文件被拒绝

- **WHEN** MCP 客户端尝试上传超过 100MB 的文件
- **THEN** 工具返回错误，不执行传输

### Requirement: 互操作性

MCP 实现 SHALL 基于官方 `@modelcontextprotocol/sdk`，SHALL 通过 Qoder 等真实客户端的接入验证。

#### Scenario: Qoder 接入

- **WHEN** 用户将接入 URL 与 token 配置到 Qoder 的 MCP 设置
- **THEN** Qoder 成功列出并调用全部工具
