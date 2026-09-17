import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IpcChannels } from '@shared/types'
import { AppContext } from './appContext'

export function registerIpcHandlers(ctx: AppContext): void {
  ipcMain.handle(IpcChannels.ping, () => 'pong')

  // ---- 连接与分组 ----
  ipcMain.handle(IpcChannels.connList, () => ctx.connections.listConnections())
  ipcMain.handle(IpcChannels.connCreate, (_e, input) => ctx.connections.createConnection(input))
  ipcMain.handle(IpcChannels.connUpdate, (_e, id, input) =>
    ctx.connections.updateConnection(id, input)
  )
  ipcMain.handle(IpcChannels.connDelete, (_e, id) => ctx.connections.deleteConnection(id))

  ipcMain.handle(IpcChannels.groupList, () => ctx.connections.listGroups())
  ipcMain.handle(IpcChannels.groupCreate, (_e, name) => ctx.connections.createGroup(name))
  ipcMain.handle(IpcChannels.groupUpdate, (_e, id, name) => ctx.connections.updateGroup(id, name))
  ipcMain.handle(IpcChannels.groupDelete, (_e, id) => ctx.connections.deleteGroup(id))

  // ---- 设置 ----
  ipcMain.handle(IpcChannels.settingsGet, () => ctx.settings.get())
  ipcMain.handle(IpcChannels.settingsUpdate, async (_e, patch) => {
    const result = await ctx.settings.update(patch)
    // MCP 开关/端口/token 变化时重启服务
    void ctx.mcp.restart().catch((err) => {
      console.error('MCP 服务重启失败:', err)
    })
    return result
  })
  ipcMain.handle(IpcChannels.settingsRegenerateToken, async () => {
    const token = await ctx.settings.regenerateToken()
    void ctx.mcp.restart().catch((err) => {
      console.error('MCP 服务重启失败:', err)
    })
    return token
  })

  // ---- 终端会话 ----
  ipcMain.handle(IpcChannels.sessionOpen, (_e, connectionId) => ctx.sessions.open(connectionId))
  ipcMain.handle(IpcChannels.sessionClose, (_e, sessionId) => ctx.sessions.close(sessionId))
  ipcMain.handle(IpcChannels.sessionReconnect, (_e, sessionId) => ctx.sessions.reconnect(sessionId))
  ipcMain.handle(IpcChannels.sessionList, () => ctx.sessions.list())
  ipcMain.on(IpcChannels.sessionInput, (_e, sessionId: string, data: Uint8Array) => {
    ctx.sessions.input(sessionId, data)
  })
  ipcMain.on(IpcChannels.sessionResize, (_e, sessionId: string, cols: number, rows: number) => {
    ctx.sessions.resize(sessionId, cols, rows)
  })

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
}
