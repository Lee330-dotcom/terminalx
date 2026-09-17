import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IpcChannels,
  RendererApi,
  SessionDataEvent,
  SessionStatusEvent,
  TransferProgressEvent,
  TransferDoneEvent
} from '../shared/types'

const api: RendererApi = {
  ping: () => ipcRenderer.invoke(IpcChannels.ping),
  listConnections: () => ipcRenderer.invoke(IpcChannels.connList),
  createConnection: (input) => ipcRenderer.invoke(IpcChannels.connCreate, input),
  updateConnection: (id, input) => ipcRenderer.invoke(IpcChannels.connUpdate, id, input),
  deleteConnection: (id) => ipcRenderer.invoke(IpcChannels.connDelete, id),
  listGroups: () => ipcRenderer.invoke(IpcChannels.groupList),
  createGroup: (name) => ipcRenderer.invoke(IpcChannels.groupCreate, name),
  updateGroup: (id, name) => ipcRenderer.invoke(IpcChannels.groupUpdate, id, name),
  deleteGroup: (id) => ipcRenderer.invoke(IpcChannels.groupDelete, id),
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannels.settingsUpdate, patch),
  regenerateToken: () => ipcRenderer.invoke(IpcChannels.settingsRegenerateToken),
  openSession: (connectionId) => ipcRenderer.invoke(IpcChannels.sessionOpen, connectionId),
  closeSession: (sessionId) => ipcRenderer.invoke(IpcChannels.sessionClose, sessionId),
  reconnectSession: (sessionId) => ipcRenderer.invoke(IpcChannels.sessionReconnect, sessionId),
  sendInput: (sessionId, data) => ipcRenderer.send(IpcChannels.sessionInput, sessionId, data),
  resizeSession: (sessionId, cols, rows) =>
    ipcRenderer.send(IpcChannels.sessionResize, sessionId, cols, rows),
  listSessions: () => ipcRenderer.invoke(IpcChannels.sessionList),
  onSessionData: (cb) => {
    const listener = (_e, ev: SessionDataEvent) => cb(ev)
    ipcRenderer.on(IpcChannels.evSessionData, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evSessionData, listener)
  },
  onSessionStatus: (cb) => {
    const listener = (_e, ev: SessionStatusEvent) => cb(ev)
    ipcRenderer.on(IpcChannels.evSessionStatus, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evSessionStatus, listener)
  },
  sftpList: (connectionId, path) =>
    ipcRenderer.invoke(IpcChannels.sftpList, connectionId, path),
  sftpMkdir: (connectionId, path) =>
    ipcRenderer.invoke(IpcChannels.sftpMkdir, connectionId, path),
  sftpDelete: (connectionId, path) =>
    ipcRenderer.invoke(IpcChannels.sftpDelete, connectionId, path),
  sftpRename: (connectionId, from, to) =>
    ipcRenderer.invoke(IpcChannels.sftpRename, connectionId, from, to),
  sftpReadText: (connectionId, path) =>
    ipcRenderer.invoke(IpcChannels.sftpReadText, connectionId, path),
  sftpUpload: (connectionId, localPath, remotePath) =>
    ipcRenderer.invoke(IpcChannels.sftpUpload, connectionId, localPath, remotePath),
  sftpDownload: (connectionId, remotePath, localPath) =>
    ipcRenderer.invoke(IpcChannels.sftpDownload, connectionId, remotePath, localPath),
  sftpCancel: (transferId) => ipcRenderer.invoke(IpcChannels.sftpCancel, transferId),
  onTransferProgress: (cb) => {
    const listener = (_e, ev: TransferProgressEvent) => cb(ev)
    ipcRenderer.on(IpcChannels.evTransferProgress, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evTransferProgress, listener)
  },
  onTransferDone: (cb) => {
    const listener = (_e, ev: TransferDoneEvent) => cb(ev)
    ipcRenderer.on(IpcChannels.evTransferDone, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evTransferDone, listener)
  },
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:open-directory')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
