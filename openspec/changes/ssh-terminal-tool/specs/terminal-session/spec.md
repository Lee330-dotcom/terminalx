# 终端会话

## ADDED Requirements

### Requirement: 会话建立

每个标签页 SHALL 对应一个 SSH 会话，主进程为每个会话维护独立的 `ssh2.Client` 实例。
会话 SHALL 建立 shell PTY 通道，使用 `TERM=xterm-256color`。
渲染进程窗口尺寸变化 SHALL 同步触发远程 PTY resize。

#### Scenario: 连接成功后打开交互终端

- **WHEN** 用户双击一个有效连接
- **THEN** 新标签页打开，出现远程 shell 提示符，可交互输入命令

#### Scenario: 调整窗口大小

- **WHEN** 用户改变标签页显示区域尺寸
- **THEN** 远程 PTY 收到 resize 请求，全屏命令（如 top、vim）显示正常

### Requirement: 数据流桥接

SSH 输出流 SHALL 通过 IPC 推送给渲染进程并写入 xterm.js。用户按键 SHALL 从 xterm.js onData 经 IPC 写入 SSH 输入流。

#### Scenario: 交互式程序

- **WHEN** 用户运行 vim 并编辑文件
- **THEN** 编辑器界面完整渲染，按键实时生效，无乱码

### Requirement: 多标签页

用户 SHALL 能新建、切换、关闭标签页。关闭标签页 SHALL 释放对应 SSH 会话资源。

#### Scenario: 同时打开多个会话

- **WHEN** 用户分别连接两台服务器
- **THEN** 两个标签页各自独立交互，互不干扰

### Requirement: 断线与重连

心跳 SHALL 每 30s 发送 keepalive，连续失败判定断线。
意外断开时标签页 SHALL 显示"已断开"和"重新连接"按钮，SHALL NOT 自动重连。

#### Scenario: 网络中断

- **WHEN** 网络中断超过心跳判定窗口
- **THEN** 标签页显示已断开状态，点击"重新连接"后恢复会话

### Requirement: 错误处理

连接失败 SHALL 在标签页内显示具体原因，区分"认证失败"（提示检查密码/密钥）与"网络不可达"（超时/拒绝连接）。

#### Scenario: 密码错误

- **WHEN** 用户使用失效密码尝试连接
- **THEN** 标签页显示认证失败及具体提示，而非仅显示"连接失败"
