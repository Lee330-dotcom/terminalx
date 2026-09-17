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

- 提交：待提交（任务 5 代码 + 任务 4 遗留的 e2e 重写）
