// 主进程与渲染进程共享的类型定义。凭据字段只允许出现在 renderer -> main 的
// 输入参数中，任何 main -> renderer 的响应都不得包含凭据。

export type AuthType = 'password' | 'privateKey'

/** 界面外观模式：浅色 / 深色 / 跟随系统 */
export type ThemeMode = 'light' | 'dark' | 'system'

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
  /** 外观模式：浅色 / 深色 / 跟随系统 */
  themeMode: ThemeMode
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

/** 服务端 /models 目录里的一个模型条目 */
export interface AiModelInfo {
  id: string
  ownedBy?: string
  created?: number
}

export interface AiModelListResult {
  ok: boolean
  models: AiModelInfo[]
  error?: string
  durationMs: number
}

/** 单次诊断探针的执行结果 */
export interface AiDiagnoseProbe {
  /** 探针标识，界面据此取文案：identity-zh / identity-en */
  id: string
  ok: boolean
  /** 响应体里回显的模型名（服务端实际路由到的模型） */
  servedModel?: string
  /** 模型自述里识别出的模型名 */
  reportedModel?: string
  /** 模型原始回答（已截断） */
  answer?: string
  error?: string
  durationMs: number
}

export type AiDiagnoseVerdict = 'match' | 'partial' | 'mismatch' | 'unknown'
export type AiDiagnoseConfidence = 'high' | 'medium' | 'low'

export interface AiDiagnoseResult {
  /** 诊断流程本身是否跑通（配置缺失、请求失败时为 false） */
  ok: boolean
  error?: string
  /** 用户配置里填写的模型名 */
  configuredModel: string
  /** 接口响应回显的模型名 */
  servedModel?: string
  /** 模型自述的模型名 */
  reportedModel?: string
  catalogChecked: boolean
  /** 配置的模型是否出现在 /models 目录中 */
  catalogMatch?: boolean
  /** 目录中同族模型（最多 5 个），便于用户纠正配置 */
  catalogSimilar: string[]
  catalogSize: number
  verdict: AiDiagnoseVerdict
  confidence: AiDiagnoseConfidence
  /** 一致性得分：>=2 一致，>=0.5 存疑，其余不一致 */
  score: number
  probes: AiDiagnoseProbe[]
  durationMs: number
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

// ---- 导入 ----

export type ImportKind = 'bastion' | 'template'

export interface ImportPreviewRow {
  name: string
  host: string
  port: number
  username: string
  remark: string
}

export interface ImportPreview {
  ok: boolean
  error?: string
  kind: ImportKind
  /** 通过校验且不与已有连接重复的行 */
  rows: ImportPreviewRow[]
  /** 文件里的数据行总数（不含表头与空行） */
  total: number
  /** 与已有连接重复、将被跳过的行数 */
  duplicates: number
  /** 字段缺失或非法、无法导入的行数 */
  invalid: number
  /** 预览用的前几条连接名 */
  samples: string[]
}

export interface ImportResult {
  created: number
  skippedDuplicates: number
  skippedErrors: number
}

export interface ImportPreviewRequest {
  kind: ImportKind
  filePath: string
}

export interface ImportApplyRequest {
  kind: ImportKind
  filePath: string
  /** 堡垒机模式：所有连接共用此密码 */
  password?: string
  /** 模板模式：按 host+port+username 匹配各行密码（可选，缺省走空密码） */
  passwordMap?: Record<string, string>
  groupId?: string | null
}

// ---- 主机指纹 ----

/** 已信任的主机公钥指纹 */
export interface HostKeyRecord {
  host: string
  port: number
  /** `SHA256:` + base64(SHA256(公钥 blob)) */
  fingerprint: string
  /** ssh-ed25519 / ssh-rsa 等 */
  keyType: string
  addedAt: number
  lastSeenAt: number
}

/** 主机指纹确认请求（主进程 → 渲染进程） */
export interface HostKeyPrompt {
  requestId: string
  host: string
  port: number
  fingerprint: string
  keyType: string
  /** 指纹库中已记录的指纹（status 为 changed 时有值） */
  storedFingerprint?: string
  /** new：首次见到的主机；changed：指纹与记录不一致 */
  status: 'new' | 'changed'
}

/** known_hosts 导入结果 */
export interface HostKeyImportResult {
  imported: number
  updated: number
  skipped: number
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
  aiListModels: 'ai:list-models',
  aiDiagnose: 'ai:diagnose',
  aiChatStart: 'ai:chat-start',
  aiChatApprove: 'ai:chat-approve',
  aiChatCancel: 'ai:chat-cancel',
  aiChatReset: 'ai:chat-reset',
  importPreview: 'import:preview',
  importApply: 'import:apply',
  hostKeyList: 'host-key:list',
  hostKeyForget: 'host-key:forget',
  hostKeyImport: 'host-key:import',
  hostKeyRespond: 'host-key:respond',
  // 主进程 -> 渲染进程事件
  evAiChunk: 'ev:ai:chunk',
  evAiDone: 'ev:ai:done',
  evAiChat: 'ev:ai:chat',
  evSessionData: 'ev:session:data',
  evSessionStatus: 'ev:session:status',
  evTransferProgress: 'ev:transfer:progress',
  evTransferDone: 'ev:transfer:done',
  evHostKeyPrompt: 'ev:host-key:prompt'
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
  /** 拉取服务端模型目录（仅查询 /models，不消耗生成额度） */
  listAiModels(): Promise<AiModelListResult>
  /** 诊断配置的模型与服务端实际返回的模型是否一致 */
  diagnoseAi(): Promise<AiDiagnoseResult>
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
  importPreview(request: ImportPreviewRequest): Promise<ImportPreview>
  importApply(request: ImportApplyRequest): Promise<ImportResult>
  /** 已信任的主机指纹列表 */
  listHostKeys(): Promise<HostKeyRecord[]>
  /** 忘记某台主机的指纹 */
  forgetHostKey(host: string, port: number): Promise<boolean>
  /** 导入 OpenSSH known_hosts；不传路径时弹出文件选择框 */
  importKnownHosts(filePath?: string): Promise<HostKeyImportResult | null>
  /** 应答一次主机指纹确认 */
  respondHostKey(requestId: string, accept: boolean): Promise<boolean>
  /** 订阅主机指纹确认请求 */
  onHostKeyPrompt(cb: (prompt: HostKeyPrompt) => void): () => void
}
