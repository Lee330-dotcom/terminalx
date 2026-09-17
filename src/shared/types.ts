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
  createdAt: number
  updatedAt: number
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
}

export interface ConnectionGroup {
  id: string
  name: string
  order: number
}

export interface ConnectionWithStatus extends ConnectionMeta {
  online: boolean
}

export interface Settings {
  mcpEnabled: boolean
  mcpPort: number
  mcpToken: string
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
  groupList: 'group:list',
  groupCreate: 'group:create',
  groupUpdate: 'group:update',
  groupDelete: 'group:delete',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsRegenerateToken: 'settings:regenerate-token',
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
  // 主进程 -> 渲染进程事件
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
  listGroups(): Promise<ConnectionGroup[]>
  createGroup(name: string): Promise<ConnectionGroup>
  updateGroup(id: string, name: string): Promise<ConnectionGroup>
  deleteGroup(id: string): Promise<void>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Omit<Settings, 'mcpToken'>>): Promise<Settings>
  regenerateToken(): Promise<string>
  openSession(connectionId: string): Promise<SessionOpenResult>
  closeSession(sessionId: string): Promise<void>
  reconnectSession(sessionId: string): Promise<void>
  sendInput(sessionId: string, data: Uint8Array): void
  resizeSession(sessionId: string, cols: number, rows: number): void
  listSessions(): Promise<SessionInfo[]>
  onSessionData(cb: (ev: SessionDataEvent) => void): () => void
  onSessionStatus(cb: (ev: SessionStatusEvent) => void): () => void
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
  openFileDialog(): Promise<string | null>
  openDirectoryDialog(): Promise<string | null>
}
