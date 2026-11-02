// 主进程与渲染进程共享的类型定义。凭据字段只允许出现在 renderer -> main 的
// 输入参数中，任何 main -> renderer 的响应都不得包含凭据。

export type AuthType = 'password' | 'privateKey'

export interface ConnectionMeta {
  id: string
  name: string
  groupId: string | null
  host: string
  port: number
  username: string
  authType: AuthType
  remark: string
  color: string
  favorite: boolean
  createdAt: number
  updatedAt: number
  /** 连接超时（毫秒），null 表示默认 15000 */
  timeoutMs: number | null
}

export interface ConnectionInput {
  name: string
  groupId: string | null
  host: string
  port: number
  username: string
  authType: AuthType
  /** 仅密码认证，null 表示不修改已有凭据 */
  password?: string | null
  /** 仅私钥认证；keyFile 与 keyContent 二选一 */
  privateKeyFile?: string
  privateKeyContent?: string
  passphrase?: string
  remark?: string
  color?: string
  /** 连接超时（毫秒），null/缺省表示默认 15000 */
  timeoutMs?: number | null
}

export interface ConnectionGroup {
  id: string
  name: string
  order: number
}

export interface ConnectionWithStatus extends ConnectionMeta {
  online: boolean
}

export interface ProbeTarget {
  id: string
  host: string
  port: number
}

export interface ProbeResult {
  id: string
  latencyMs: number | null
}

export interface ConnectionTestResult {
  ok: boolean
  error?: string
  durationMs?: number
}

export interface Settings {
  mcpEnabled: boolean
  mcpPort: number
  mcpToken: string
  /** 被禁用的 MCP 工具名（不注册到 server） */
  mcpDisabledTools: string[]
  /** 主题色（hex），应用到 Element Plus 主色与界面强调色 */
  themeColor: string
  /** 主背景色（hex） */
  backgroundColor: string
  /** 顶部导航栏背景色（hex） */
  navColor: string
  /** 跟随系统深色/浅色主题（亮色用「明亮」预设，暗色用「暗夜」预设） */
  followSystemTheme: boolean
  /** 界面字体，空串表示系统默认 */
  uiFont: string
  /** 窗口不透明度（60-100） */
  windowOpacity: number
  /** 界面缩放百分比（80-140） */
  uiScale: number
  /** 开机自启动 */
  autoLaunch: boolean
  /** 禁用硬件加速（重启后生效） */
  disableHardwareAcceleration: boolean
  /** 阻止系统休眠 */
  blockSystemSleep: boolean
  /** 关闭按钮行为：quit 退出程序 / hide 隐藏到 Dock 保留会话 */
  closeButtonAction: 'quit' | 'hide'
  /** 退出前弹确认框（仅关闭按钮行为为「退出程序」时生效） */
  confirmOnClose: boolean
  /** 界面语言 */
  language: 'zh-CN' | 'en-US'
  /** OpenAI 兼容服务地址，如 https://api.openai.com/v1 */
  aiBaseUrl: string
  /** 模型名，空串表示未配置 */
  aiModel: string
  /** 允许助手自动执行只读白名单命令；关闭时所有命令都需要确认 */
  aiAutoExecute: boolean
}

// ---- AI 只读分析 ----

export type AiAnalysisKind =
  'selection-explanation' | 'session-summary' | 'connection-diagnosis' | 'command-suggestion'

export interface AiAnalysisRequest {
  /** 渲染进程生成，用于关联流式事件 */
  requestId: string
  kind: AiAnalysisKind
  sessionId?: string
  /** 选段解释的选中文本 */
  selection?: string
  connectionId?: string
  errorMessage?: string
  /** 命令建议的自然语言指令 */
  instruction?: string
}

export interface AiStatus {
  /** Base URL、模型与 API Key 都已配置 */
  configured: boolean
  /** 已保存 API Key（不回传内容） */
  keySet: boolean
  baseUrl: string
  model: string
}

export interface AiChunkEvent {
  requestId: string
  delta: string
}

export interface AiDoneEvent {
  requestId: string
  error?: string
  cancelled?: boolean
}

export interface AiTestResult {
  ok: boolean
  error?: string
  durationMs?: number
}

// ---- AI 助手（全自动） ----

export type CommandRiskLevel = 'low' | 'medium' | 'high' | 'unknown'

export interface AiChatStartRequest {
  requestId: string
  sessionId: string
  connectionId: string
  text: string
}

export interface AiChatToolResult {
  stdout: string
  stderr: string
  exitCode: number | null
  truncated: boolean
  durationMs: number
}

export type AiChatEvent =
  | { type: 'delta'; requestId: string; delta: string }
  | {
      type: 'tool-call'
      requestId: string
      callId: string
      command: string
      purpose: string
      risk: CommandRiskLevel
      requiresApproval: boolean
      reason?: string
    }
  | {
      type: 'tool-result'
      requestId: string
      callId: string
      ok: boolean
      rejected?: boolean
      error?: string
      result?: AiChatToolResult
    }
  | { type: 'step-limit'; requestId: string; limit: number }
  | { type: 'done'; requestId: string; error?: string; cancelled?: boolean }

export interface AppInfo {
  version: string
  platform: string
}

export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface SessionInfo {
  id: string
  connectionId: string
  title: string
  status: SessionStatus
  errorMessage?: string
}

export interface SessionOpenResult {
  sessionId: string
}

// ---- MCP 工具参数与结果类型 ----

export interface ExecCommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  truncated: boolean
  durationMs: number
}

export interface SftpEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  mode: number
  mtime: number
}

export interface SftpListResult {
  path: string
  entries: SftpEntry[]
}

export interface ReadTerminalResult {
  sessionId: string
  lines: string[]
  totalLines: number
}

export interface TransferResult {
  ok: boolean
  message: string
  bytesTransferred: number
}

// ---- IPC 通道 ----

export const IpcChannels = {
  ping: 'ping',
  connList: 'conn:list',
  connCreate: 'conn:create',
  connUpdate: 'conn:update',
  connDelete: 'conn:delete',
  connToggleFavorite: 'conn:toggle-favorite',
  connProbe: 'conn:probe',
  connTest: 'conn:test',
  groupList: 'group:list',
  groupCreate: 'group:create',
  groupUpdate: 'group:update',
  groupDelete: 'group:delete',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsRegenerateToken: 'settings:regenerate-token',
  settingsExport: 'settings:export',
  settingsImport: 'settings:import',
  appInfo: 'app:info',
  sessionOpen: 'session:open',
  sessionClose: 'session:close',
  sessionInput: 'session:input',
  sessionResize: 'session:resize',
  sessionReconnect: 'session:reconnect',
  sessionList: 'session:list',
  sessionStatus: 'session:status',
  sftpOpen: 'sftp:open',
  sftpClose: 'sftp:close',
  sftpList: 'sftp:list',
  sftpMkdir: 'sftp:mkdir',
  sftpDelete: 'sftp:delete',
  sftpRename: 'sftp:rename',
  sftpReadText: 'sftp:read-text',
  sftpUpload: 'sftp:upload',
  sftpDownload: 'sftp:download',
  sftpCancel: 'sftp:cancel',
  aiStatus: 'ai:status',
  aiAnalyze: 'ai:analyze',
  aiCancel: 'ai:cancel',
  aiSetKey: 'ai:set-key',
  aiTest: 'ai:test',
  aiChatStart: 'ai:chat-start',
  aiChatApprove: 'ai:chat-approve',
  aiChatCancel: 'ai:chat-cancel',
  aiChatReset: 'ai:chat-reset',
  // 主进程 -> 渲染进程事件
  evAiChunk: 'ev:ai:chunk',
  evAiDone: 'ev:ai:done',
  evAiChat: 'ev:ai:chat',
  evSessionData: 'ev:session:data',
  evSessionStatus: 'ev:session:status',
  evTransferProgress: 'ev:transfer:progress',
  evTransferDone: 'ev:transfer:done'
} as const

export interface SessionDataEvent {
  sessionId: string
  data: Uint8Array
}

export interface SessionStatusEvent {
  sessionId: string
  status: SessionStatus
  errorMessage?: string
}

export interface TransferProgressEvent {
  transferId: string
  direction: 'upload' | 'download'
  remotePath: string
  localPath: string
  transferred: number
  total: number
}

export interface TransferDoneEvent {
  transferId: string
  ok: boolean
  error?: string
}

// ---- preload 暴露给渲染进程的 API 面 ----

export interface RendererApi {
  ping(): Promise<string>
  listConnections(): Promise<ConnectionWithStatus[]>
  createConnection(input: ConnectionInput): Promise<ConnectionMeta>
  updateConnection(id: string, input: ConnectionInput): Promise<ConnectionMeta>
  deleteConnection(id: string): Promise<void>
  toggleFavorite(id: string): Promise<ConnectionMeta>
  probeConnections(targets: ProbeTarget[]): Promise<ProbeResult[]>
  /** 用表单值做一次性连接测试；编辑时传 existingId 可复用已保存凭据 */
  testConnection(input: ConnectionInput, existingId?: string): Promise<ConnectionTestResult>
  listGroups(): Promise<ConnectionGroup[]>
  createGroup(name: string): Promise<ConnectionGroup>
  updateGroup(id: string, name: string): Promise<ConnectionGroup>
  deleteGroup(id: string): Promise<void>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Omit<Settings, 'mcpToken'>>): Promise<Settings>
  regenerateToken(): Promise<string>
  exportSettings(): Promise<string | null>
  importSettings(): Promise<{ ok: boolean; error?: string }>
  getAppInfo(): Promise<AppInfo>
  openSession(connectionId: string): Promise<SessionOpenResult>
  closeSession(sessionId: string): Promise<void>
  reconnectSession(sessionId: string): Promise<void>
  sendInput(sessionId: string, data: Uint8Array): void
  resizeSession(sessionId: string, cols: number, rows: number): void
  listSessions(): Promise<SessionInfo[]>
  onSessionData(cb: (ev: SessionDataEvent) => void): () => void
  onSessionStatus(cb: (ev: SessionStatusEvent) => void): () => void
  aiStatus(): Promise<AiStatus>
  /** 发起只读分析，请求在后台流式推送；调用方需先自行生成 requestId */
  aiAnalyze(request: AiAnalysisRequest): Promise<void>
  cancelAi(requestId: string): void
  setAiKey(apiKey: string | null): Promise<AiStatus>
  testAi(): Promise<AiTestResult>
  onAiChunk(cb: (ev: AiChunkEvent) => void): () => void
  onAiDone(cb: (ev: AiDoneEvent) => void): () => void
  aiChatStart(request: AiChatStartRequest): Promise<void>
  aiChatApprove(requestId: string, callId: string, approved: boolean): void
  aiChatCancel(requestId: string): void
  aiChatReset(sessionId: string): void
  onAiChatEvent(cb: (ev: AiChatEvent) => void): () => void
  sftpList(connectionId: string, path: string): Promise<SftpListResult>
  sftpMkdir(connectionId: string, path: string): Promise<void>
  sftpDelete(connectionId: string, path: string): Promise<void>
  sftpRename(connectionId: string, from: string, to: string): Promise<void>
  sftpReadText(connectionId: string, path: string): Promise<string>
  sftpUpload(connectionId: string, localPath: string, remotePath: string): Promise<string>
  sftpDownload(connectionId: string, remotePath: string, localPath: string): Promise<string>
  sftpCancel(transferId: string): Promise<void>
  onTransferProgress(cb: (ev: TransferProgressEvent) => void): () => void
  onTransferDone(cb: (ev: TransferDoneEvent) => void): () => void
  /** 拖拽文件的真实磁盘路径（webUtils.getPathForFile）。 */
  getPathForFile(file: unknown): string
  openFileDialog(): Promise<string | null>
  openDirectoryDialog(): Promise<string | null>
}
