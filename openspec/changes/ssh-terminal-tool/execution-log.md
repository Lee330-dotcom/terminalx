# 执行日志

记录 ssh-terminal-tool OpenSpec 变更的实施命令与验证证据。

## 2026-09-17

### 任务 4 终端会话（完成）

- `npm run test:e2e` → src/e2e/app.spec.ts 2/2 通过（真实 Electron + 本地 ssh2 测试服务器：双击连接打开终端、欢迎输出、键盘回显、关闭标签；坏密码显示认证失败面板）
- 提交：`2264684 feat: terminal sessions with ssh2 connection pooling and xterm.js`
- 单元/集成测试：`npm test` 24/24 通过（describeSshError、exec、认证失败、连接复用、空闲销毁、会话输出、输入回显、readLines 等）

### 任务 5 SFTP 文件传输（完成）

- 新增 `src/main/ssh/sftpService.ts`：openSftp 复用连接池、list/mkdir/delete(rmdir|unlink)/rename/readText(1MB 截断)、上传下载全局串行队列、进度节流 100ms、取消（排队中直接移除 / 进行中销毁双流）、取消后清理残留（远端 unlink / 本地 unlink）
- 路径安全：normalizeRemotePath 拒绝 `..` 片段与非绝对路径（`src/main/ssh/__tests__/sftpService.test.ts` 7/7 通过）
- 集成测试（fake sftp 通道，`sftpService.integration.test.ts` 10/10 通过）：列表排序、mkdir/rename/delete、readText 截断、上传/下载内容与进度、队列串行、取消排队中传输、取消进行中下载并清理本地残留
- `npm test` → 41/41 通过；`npm run typecheck` 通过
- e2e 新增第 3 用例（文件面板打开 + 无 SFTP 子系统时优雅报错），`npm run test:e2e` 3/3 通过
- 修复过程中发现的 bug：SftpPanel 初始不加载目录（watch 缺 immediate）；readText destroy 截断后无 end 事件（补 close 兜底）
- 可视化验证：CDP 截图确认面板布局（路径栏/工具栏/表格/空目录态/错误 toast）
- 未覆盖：真实 SFTP 服务器的 50MB 传输与取消手工验证 → 归入任务 8 手工清单
- 注：曾尝试安装 ssh2-sftp-server 做真 SFTP 集成测试，被权限系统拦截，改用 fake 通道方案

### 任务 4/5 通用证据

- 提交：`2c59de4 feat: SFTP file transfer with panel UI, transfer queue and cancel`（任务 5 代码 + 任务 4 遗留的 e2e 重写）

### 任务 6 MCP Server（完成）

- 新增 `src/main/mcp/mcpService.ts`：
  - StreamableHTTPServerTransport 监听 127.0.0.1，Bearer token 鉴权（timingSafeEqual），设置变更/换 token 后自动 restart
  - **无状态模式**：每个请求新建 McpServer + transport，响应 close 后销毁（初版复用 transport 导致第 2 个请求起全部 500，序列实验 200/500/500/500 定位，参考官方 simpleStatelessStreamableHttp.js 修复后 200/200/200/200）；非 POST 返回 405、未知路径 404、错误 body 400
  - 7 个工具：list_connections（不含凭据字段）/ list_sessions / exec_command（50KB 截断：stdout 头尾各 24KB + stderr 头尾各 1KB + 省略标记）/ read_terminal / sftp_list / sftp_upload / sftp_download（经 uploadAndWait/downloadAndWait 复用 100MB 上限与取消）
- 测试 `src/main/mcp/__tests__/mcpService.test.ts` 13/13 通过（任务 6 提交时）：截断 3 个、401（无/错 token）、initialize 握手、tools/list 7 工具、list_connections 无凭据（解析 JSON 断言无 password/privateKey*/passphrase 键）、list_sessions、exec 小/大、read_terminal、sftp 三工具、404/400、mcpEnabled=false 不启动；任务 7 补参数校验后 14/14
- `npm test` → 54/54 通过；`npm run typecheck` 通过；`npm run test:e2e` 3/3 通过（回归）
- 过程中发现的测试问题：list_connections 断言因 `"authType": "password"` 子串误判 → 改为解析后检查键；JSON.stringify 无空格 → 断言改 `"ok":true`
- 未覆盖：真实 MCP 客户端（Qoder）接入验证 → 归入任务 8

### 任务 7 测试（完成）

- 测试盘点（9 个文件）：
  - 凭据加密：`credentialVault.test.ts`（AES-GCM 加解密、错误 key、篡改检测）
  - 数据层：`connectionStore.test.ts`（无凭据落盘）、`settingsStore.test.ts`（token 重生成）
  - 路径安全：`sftpService.test.ts` 7 个（`../` 拒绝、相对路径拒绝、斜杠折叠、非字符串）
  - MCP：`mcpService.test.ts` 14 个（截断 3、鉴权、握手、tools/list、无凭据字段、zod 参数校验新增）
  - 集成：`connectionManager.test.ts` 9 个（ssh2 Server 本地临时服务：连接、exec、认证失败、空闲销毁、会话输出/回显/readLines）
  - SFTP 集成：`sftpService.integration.test.ts` 10 个（fake sftp 通道）
  - e2e：`app.spec.ts` 3 个（真实 Electron + ssh2 测试服务器）
- `npm run test` → 55/55 通过；`npm run typecheck` 通过；`npm run test:e2e` 3/3 通过
- 7.2 偏差说明：连接/exec 全链路用 ssh2 Server 类真实覆盖；SFTP 上传下载因 ssh2-sftp-server 被权限系统拦截，用 fake 通道替代，真实 SFTP 全链路归任务 8 手工清单
- 新增测试：exec_command 缺 connection_id 被 zod schema 拒绝（isError + 错误信息含字段名）
- 提交：`97a09b0 feat: MCP server with 7 tools over stateless Streamable HTTP`（任务 6/7 代码）
