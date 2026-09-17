# SFTP 文件传输

## ADDED Requirements

### Requirement: 面板与浏览

每个终端标签页 SHALL 可打开 SFTP 面板，展示远程目录树与文件列表（名称、大小、权限、修改时间）。
SFTP 通道 SHALL 复用同一 SSH 连接的独立子通道，不影响终端 shell 通道。

#### Scenario: 打开 SFTP 面板

- **WHEN** 用户在已打开的终端会话中打开 SFTP 面板
- **THEN** 面板显示远程当前目录内容，终端仍可正常交互

### Requirement: 上传与下载

用户 SHALL 能通过文件选择器或拖拽上传本地文件。用户 SHALL 能选择远程文件下载到本地目录。
传输 SHALL 显示进度（字节数/总字节数），且 SHALL 支持取消。传输 SHALL 在后台队列执行，不阻塞终端交互。

#### Scenario: 拖拽上传并显示进度

- **WHEN** 用户拖入一个大文件
- **THEN** 显示进度条，传输期间终端可继续使用；完成后文件出现在远程列表中

#### Scenario: 取消传输

- **WHEN** 用户取消进行中的传输
- **THEN** 传输停止，已传输的部分文件被清理，无残留损坏文件

### Requirement: 文件操作

用户 SHALL 能新建文件夹、删除、重命名远程文件/目录。用户 SHALL 能双击预览文本文件。删除操作 SHALL 要求确认。

#### Scenario: 删除确认

- **WHEN** 用户删除远程文件
- **THEN** 系统 SHALL 弹出确认对话框，确认后才执行

### Requirement: 路径安全

所有远程路径处理 SHALL 在主进程用 `path.posix` 归一化，SHALL 拒绝路径穿越。

#### Scenario: 路径穿越防护

- **WHEN** 恶意远程路径（含 `../`）被提交给下载/列表接口
- **THEN** 系统拒绝操作，不会访问远程目录之外的位置
