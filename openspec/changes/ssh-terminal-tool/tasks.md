# 实施任务（tasks.md）

## 1. 项目脚手架

- [ ] 1.1 搭建 Electron + Vite + Vue 3 + TypeScript 项目骨架（electron-vite 结构：main/preload/renderer 三目录），配置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 安装依赖；验证：`npm run dev` 能打开空白应用窗口
- [ ] 1.2 安装核心依赖：ssh2、@modelcontextprotocol/sdk、@xterm/xterm、@xterm/addon-fit、element-plus、pinia、vitest；验证：`npm run typecheck` 通过
- [ ] 1.3 定义 `src/shared/` 共享类型（连接配置、IPC 通道名与消息类型、MCP 工具参数类型）并打通 preload contextBridge 最小 API；验证：渲染进程能调用一个 `ping` IPC 并收到响应
- [ ] 1.4 配置 electron-builder（macOS dmg，appId，productName 占位）；验证：`npm run build:mac` 产出 dmg 文件

## 2. 数据层与凭据安全

- [ ] 2.1 实现 `settings.json` 存储（MCP 端口、token、启停状态），首次启动生成随机 token；验证：单元测试覆盖默认值与读写
- [ ] 2.2 实现凭据加密模块：safeStorage 生成/加载主密钥 + AES-256-GCM 加解密密码与私钥；验证：单元测试验证密文不含明文、解密还原一致、重启（重新加载密钥）后仍可解密
- [ ] 2.3 实现 `connections.json` 存储（CRUD、两级分组、拖拽排序持久化、原子写入）；验证：单元测试覆盖增删改查与"连接记录不含密码字段"
- [ ] 2.4 打通主进程 ConnectionStore/SettingStore 与渲染进程的 IPC 读写接口；验证：渲染进程保存连接后重启应用数据仍在

## 3. 连接管理 UI

- [ ] 3.1 左侧栏连接树：分组树、连接列表、状态图标、搜索过滤；验证：手动创建分组和连接后树形展示正确
- [ ] 3.2 新建/编辑连接表单（主机/端口/用户名/认证方式切换/备注/标签色），密码与私钥字段走加密存储接口；验证：保存后 `connections.json` 无密码，重启后凭据可用
- [ ] 3.3 连接操作：双击连接发起会话、右键菜单（编辑/删除/复制）、拖拽移动；验证：删除含连接的分组弹确认且连接移到未分组
- [ ] 3.4 设置页：MCP 开关、端口配置、token 显示/复制/重新生成；验证：重生成 token 后旧 token 立即失效（curl 验证 401）

## 4. 终端会话

- [ ] 4.1 主进程 ConnectionManager：按连接 ID 维护 ssh2 Client（引用计数 + 60s 延迟销毁）、keepalive 配置；验证：单元测试模拟连接建立与释放
- [ ] 4.2 终端标签页：xterm.js 初始化、shell 通道字节流 IPC 桥接（主进程 16ms 合并推送、渲染层字节直写）、resize 同步；验证：手动连接真实服务器，vim/top 全屏渲染正常、中文不乱码
- [ ] 4.3 多标签页管理：新建/切换/关闭标签，关闭时释放通道；验证：开两个服务器会话互不干扰，关闭标签后连接计数归零
- [ ] 4.4 断线与错误处理：close 事件置"已断开"态 + 重新连接按钮，区分认证失败/网络不可达提示；验证：错密码连接显示认证失败提示；断开网络后标签显示已断开且重连按钮可用

## 5. SFTP 文件传输

- [x] 5.1 主进程 SftpService：复用连接开 sftp 通道，列表/建目录/删除/重命名/读文本，path.posix 归一化防穿越；验证：单元测试验证 `../` 路径被拒绝
- [x] 5.2 SFTP 面板 UI：目录树 + 文件列表（名称/大小/权限/时间）、双击预览文本；验证：手动打开面板浏览远程目录
- [x] 5.3 上传/下载：文件选择器 + 拖拽上传、下载到本地目录、进度条、取消、后台队列；验证：手动传 50MB 文件显示进度、取消后无残留文件

## 6. MCP Server

- [x] 6.1 主进程 McpServer：StreamableHTTPServer 监听 127.0.0.1:<port>，Bearer token 中间件，启停接口；验证：curl 无 token 返回 401，带 token 完成 initialize 握手
- [x] 6.2 实现工具 `list_connections` / `list_sessions`：连接列表不含凭据、会话列表含标签标题；验证：curl 调用返回结构正确且无密码字段
- [x] 6.3 实现工具 `exec_command`（复用/临时连接、exec 通道、超时、50KB 截断带标记）；验证：curl 执行命令返回 stdout/stderr/exit code；输出超限时被截断；执行时交互终端无干扰
- [x] 6.4 实现工具 `read_terminal`（会话环形滚动缓冲 10000 行，读最近 N 行）；验证：终端执行多条命令后调用返回最近 N 行
- [x] 6.5 实现工具 `sftp_list` / `sftp_upload` / `sftp_download`（100MB 上限拒绝）；验证：curl 上传下载小文件成功，超过上限返回错误

## 7. 测试

- [x] 7.1 凭据加密、路径安全、MCP 截断/参数校验单元测试齐备；验证：`npm run test` 全绿
- [x] 7.2 用 ssh2 Server 类起本地临时 SSH 服务（随机端口 + 测试密钥）做集成测试：连接、exec 命令、SFTP 上传下载全链路；验证：集成测试通过，不依赖外部服务器

## 8. 打包与端到端验证

- [x] 8.1 端到端手工验证清单：建连接 → 开终端 → SFTP 拖拽上传 → 断开重连（人工走一遍并记录问题）；验证：清单各项通过
- [x] 8.2 用 Qoder 配置 MCP 接入 URL + token，验证 AI 能调用全部 7 个工具；验证：Qoder 工具列表完整且执行命令成功
- [x] 8.3 electron-builder 打 dmg 并安装验证（含 safeStorage、MCP 端口、数据持久化）；验证：安装包可运行，重启后数据与 token 保持
