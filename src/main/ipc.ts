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
  ipcMain.handle(IpcChannels.settingsUpdate, (_e, patch) => ctx.settings.update(patch))
  ipcMain.handle(IpcChannels.settingsRegenerateToken, () => ctx.settings.regenerateToken())

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
