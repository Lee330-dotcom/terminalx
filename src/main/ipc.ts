import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { promises as fs } from 'fs'
import {
  AiAnalysisRequest,
  AiChatStartRequest,
  ConnectionInput,
  IpcChannels,
  ImportApplyRequest,
  ImportPreviewRequest,
  ProbeTarget,
  Settings
} from '@shared/types'
import { AppContext } from './appContext'
import { probeTargets } from './ssh/latencyProbe'
import { describeSshError, testConnect } from './ssh/connectionManager'
import { buildConnectConfigFromInput } from './ssh/config'
import { parseKnownHosts } from './ssh/hostKeyUtils'
import { applySystemSettings, applyWindowUi } from './uiSettings'
import { buildPreview, toConnectionInputs } from './import/importService'

const MCP_SETTING_KEYS = ['mcpEnabled', 'mcpPort', 'mcpDisabledTools'] as const

function mcpSettingsChanged(patch: Partial<Omit<Settings, 'mcpToken'>>): boolean {
  return MCP_SETTING_KEYS.some((k) => k in patch)
}

export function registerIpcHandlers(ctx: AppContext): void {
  ipcMain.handle(IpcChannels.ping, () => 'pong')

  // ---- 连接与分组 ----
  ipcMain.handle(IpcChannels.connList, () =>
    ctx.connections.listConnectionsWithStatus((id) => ctx.ssh.isOnline(id))
  )
  ipcMain.handle(IpcChannels.connCreate, (_e, input) => ctx.connections.createConnection(input))
  ipcMain.handle(IpcChannels.connUpdate, (_e, id, input) =>
    ctx.connections.updateConnection(id, input)
  )
  ipcMain.handle(IpcChannels.connDelete, (_e, id) => ctx.connections.deleteConnection(id))
  ipcMain.handle(IpcChannels.connToggleFavorite, (_e, id) => ctx.connections.toggleFavorite(id))
  ipcMain.handle(IpcChannels.connProbe, (_e, targets: ProbeTarget[]) => probeTargets(targets))
  ipcMain.handle(IpcChannels.connTest, async (_e, input: ConnectionInput, existingId?: string) => {
    const started = Date.now()
    try {
      const fallback = existingId ? await ctx.connections.getSecret(existingId) : null
      const config = await buildConnectConfigFromInput(
        input,
        fallback,
        ctx.hostKeyOptions(input.host, input.port)
      )
      await testConnect(config)
      return { ok: true, durationMs: Date.now() - started }
    } catch (err) {
      return { ok: false, error: describeSshError(err as Error) }
    }
  })

  ipcMain.handle(IpcChannels.groupList, () => ctx.connections.listGroups())
  ipcMain.handle(IpcChannels.groupCreate, (_e, name) => ctx.connections.createGroup(name))
  ipcMain.handle(IpcChannels.groupUpdate, (_e, id, name) => ctx.connections.updateGroup(id, name))
  ipcMain.handle(IpcChannels.groupDelete, (_e, id) => ctx.connections.deleteGroup(id))

  // ---- 设置 ----
  ipcMain.handle(IpcChannels.settingsGet, () => ctx.settings.get())
  ipcMain.handle(IpcChannels.settingsUpdate, async (_e, patch) => {
    const result = await ctx.settings.update(patch)
    applySystemSettings(result)
    applyWindowUi(result)
    // 仅 MCP 相关字段变化时重启服务
    if (mcpSettingsChanged(patch)) {
      void ctx.mcp.restart().catch((err) => {
        console.error('MCP 服务重启失败:', err)
      })
    }
    return result
  })
  ipcMain.handle(IpcChannels.settingsRegenerateToken, async () => {
    const token = await ctx.settings.regenerateToken()
    void ctx.mcp.restart().catch((err) => {
      console.error('MCP 服务重启失败:', err)
    })
    return token
  })
  ipcMain.handle(IpcChannels.settingsExport, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const settings = await ctx.settings.get()
    const date = new Date().toISOString().slice(0, 10)
    const opts = {
      defaultPath: `terminalx-settings-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, JSON.stringify(settings, null, 2), 'utf8')
    return result.filePath
  })
  ipcMain.handle(IpcChannels.settingsImport, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = {
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: '已取消' }
    try {
      const raw = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'))
      const settings = await ctx.settings.replace(raw)
      applySystemSettings(settings)
      applyWindowUi(settings)
      void ctx.mcp.restart().catch((err) => {
        console.error('MCP 服务重启失败:', err)
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
  ipcMain.handle(IpcChannels.appInfo, () => ({
    version: app.getVersion(),
    platform: process.platform
  }))

  // ---- 终端会话 ----
  ipcMain.handle(IpcChannels.sessionOpen, (_e, connectionId) => ctx.sessions.open(connectionId))
  ipcMain.handle(IpcChannels.sessionClose, (_e, sessionId) => {
    ctx.agent.reset(sessionId)
    return ctx.sessions.close(sessionId)
  })
  ipcMain.handle(IpcChannels.sessionReconnect, (_e, sessionId) => ctx.sessions.reconnect(sessionId))
  ipcMain.handle(IpcChannels.sessionList, () => ctx.sessions.list())
  ipcMain.on(IpcChannels.sessionInput, (_e, sessionId: string, data: Uint8Array) => {
    ctx.sessions.input(sessionId, data)
  })
  ipcMain.on(IpcChannels.sessionResize, (_e, sessionId: string, cols: number, rows: number) => {
    ctx.sessions.resize(sessionId, cols, rows)
  })

  // ---- AI 只读分析 ----
  ipcMain.handle(IpcChannels.aiStatus, () => ctx.ai.status())
  ipcMain.handle(IpcChannels.aiAnalyze, (_e, request: AiAnalysisRequest) => ctx.ai.analyze(request))
  ipcMain.on(IpcChannels.aiCancel, (_e, requestId: string) => ctx.ai.cancel(requestId))
  ipcMain.handle(IpcChannels.aiSetKey, (_e, apiKey: string | null) => ctx.ai.setApiKey(apiKey))
  ipcMain.handle(IpcChannels.aiTest, () => ctx.ai.test())
  ipcMain.handle(IpcChannels.aiListModels, () => ctx.ai.listModels())
  ipcMain.handle(IpcChannels.aiDiagnose, () => ctx.ai.diagnose())

  // ---- AI 全自动助手 ----
  ipcMain.handle(IpcChannels.aiChatStart, (_e, request: AiChatStartRequest) =>
    ctx.agent.start(request)
  )
  ipcMain.on(
    IpcChannels.aiChatApprove,
    (_e, requestId: string, callId: string, approved: boolean) => {
      ctx.agent.approve(requestId, callId, approved === true)
    }
  )
  ipcMain.on(IpcChannels.aiChatCancel, (_e, requestId: string) => ctx.agent.cancel(requestId))
  ipcMain.on(IpcChannels.aiChatReset, (_e, sessionId: string) => ctx.agent.reset(sessionId))

  // ---- SFTP ----
  ipcMain.handle(IpcChannels.sftpList, (_e, connectionId, path) =>
    ctx.sftp.list(connectionId, path)
  )
  ipcMain.handle(IpcChannels.sftpMkdir, (_e, connectionId, path) =>
    ctx.sftp.mkdir(connectionId, path)
  )
  ipcMain.handle(IpcChannels.sftpDelete, (_e, connectionId, path) =>
    ctx.sftp.delete(connectionId, path)
  )
  ipcMain.handle(IpcChannels.sftpRename, (_e, connectionId, from, to) =>
    ctx.sftp.rename(connectionId, from, to)
  )
  ipcMain.handle(IpcChannels.sftpReadText, (_e, connectionId, path) =>
    ctx.sftp.readText(connectionId, path)
  )
  ipcMain.handle(IpcChannels.sftpUpload, (_e, connectionId, localPath, remotePath) =>
    ctx.sftp.upload(connectionId, localPath, remotePath)
  )
  ipcMain.handle(IpcChannels.sftpDownload, (_e, connectionId, remotePath, localPath) =>
    ctx.sftp.download(connectionId, remotePath, localPath)
  )
  ipcMain.handle(IpcChannels.sftpCancel, (_e, transferId) => ctx.sftp.cancel(transferId))
  // ---- 主机指纹 ----
  ipcMain.handle(IpcChannels.hostKeyList, () => ctx.hostKeys.list())
  ipcMain.handle(IpcChannels.hostKeyForget, (_e, host: string, port: number) =>
    ctx.hostKeys.forget(host, port)
  )
  ipcMain.handle(IpcChannels.hostKeyImport, async (e, filePath?: string) => {
    let target = filePath
    if (!target) {
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts = {
        properties: ['openFile' as const],
        filters: [{ name: 'known_hosts', extensions: ['txt', 'known_hosts'] }]
      }
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts)
      if (result.canceled || !result.filePaths[0]) return null
      target = result.filePaths[0]
    }
    const content = await fs.readFile(target, 'utf-8')
    const parsed = parseKnownHosts(content)
    const result = await ctx.hostKeys.importRecords(parsed.entries)
    return { ...result, skipped: parsed.skipped }
  })
  ipcMain.handle(IpcChannels.hostKeyRespond, (_e, requestId: string, accept: boolean) => {
    ctx.hostKeyGate.respond(requestId, accept === true)
    return true
  })

  // ---- 文件对话框 ----
  ipcMain.handle('dialog:open-file', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'] })
      : await dialog.showOpenDialog({ properties: ['openFile'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('dialog:open-directory', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // ---- 导入 ----
  ipcMain.handle(IpcChannels.importPreview, async (_e, req: ImportPreviewRequest) => {
    const content = await fs.readFile(req.filePath, 'utf-8')
    const existing = await ctx.connections.listConnections()
    return buildPreview(req.kind, content, existing)
  })

  ipcMain.handle(IpcChannels.importApply, async (_e, req: ImportApplyRequest) => {
    const content = await fs.readFile(req.filePath, 'utf-8')
    const existing = await ctx.connections.listConnections()
    const preview = buildPreview(req.kind, content, existing)
    if (!preview.ok) throw new Error(preview.error ?? '导入预览失败')
    const password = req.kind === 'bastion' ? (req.password ?? null) : null
    const inputs = toConnectionInputs(preview, req.groupId ?? null, password)
    // 模板模式：按 host+port+username 注入各行密码
    if (req.kind === 'template' && req.passwordMap) {
      for (const input of inputs) {
        const key = `${input.host}:${input.port}:${input.username}`
        if (req.passwordMap[key]) input.password = req.passwordMap[key]
      }
    }
    const created = await ctx.connections.createMany(inputs)
    return {
      created: created.length,
      skippedDuplicates: preview.duplicates,
      skippedErrors: preview.invalid
    }
  })
}
