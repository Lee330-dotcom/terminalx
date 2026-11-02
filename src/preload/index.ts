import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  AiChatEvent,
  AiChunkEvent,
  AiDoneEvent,
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
  toggleFavorite: (id) => ipcRenderer.invoke(IpcChannels.connToggleFavorite, id),
  probeConnections: (targets) => ipcRenderer.invoke(IpcChannels.connProbe, targets),
  testConnection: (input, existingId) =>
    ipcRenderer.invoke(IpcChannels.connTest, input, existingId),
  listGroups: () => ipcRenderer.invoke(IpcChannels.groupList),
  createGroup: (name) => ipcRenderer.invoke(IpcChannels.groupCreate, name),
  updateGroup: (id, name) => ipcRenderer.invoke(IpcChannels.groupUpdate, id, name),
  deleteGroup: (id) => ipcRenderer.invoke(IpcChannels.groupDelete, id),
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannels.settingsUpdate, patch),
  regenerateToken: () => ipcRenderer.invoke(IpcChannels.settingsRegenerateToken),
  exportSettings: () => ipcRenderer.invoke(IpcChannels.settingsExport),
  importSettings: () => ipcRenderer.invoke(IpcChannels.settingsImport),
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.appInfo),
  openSession: (connectionId) => ipcRenderer.invoke(IpcChannels.sessionOpen, connectionId),
  closeSession: (sessionId) => ipcRenderer.invoke(IpcChannels.sessionClose, sessionId),
  reconnectSession: (sessionId) => ipcRenderer.invoke(IpcChannels.sessionReconnect, sessionId),
  sendInput: (sessionId, data) => ipcRenderer.send(IpcChannels.sessionInput, sessionId, data),
  resizeSession: (sessionId, cols, rows) =>
    ipcRenderer.send(IpcChannels.sessionResize, sessionId, cols, rows),
  listSessions: () => ipcRenderer.invoke(IpcChannels.sessionList),
  onSessionData: (cb): (() => void) => {
    const listener: (e: IpcRendererEvent, ev: SessionDataEvent) => void = (_e, ev) => cb(ev)
    ipcRenderer.on(IpcChannels.evSessionData, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evSessionData, listener)
  },
  onSessionStatus: (cb): (() => void) => {
    const listener: (e: IpcRendererEvent, ev: SessionStatusEvent) => void = (_e, ev) => cb(ev)
    ipcRenderer.on(IpcChannels.evSessionStatus, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evSessionStatus, listener)
  },
  aiStatus: () => ipcRenderer.invoke(IpcChannels.aiStatus),
  aiAnalyze: (request) => ipcRenderer.invoke(IpcChannels.aiAnalyze, request),
  cancelAi: (requestId) => ipcRenderer.send(IpcChannels.aiCancel, requestId),
  setAiKey: (apiKey) => ipcRenderer.invoke(IpcChannels.aiSetKey, apiKey),
  testAi: () => ipcRenderer.invoke(IpcChannels.aiTest),
  onAiChunk: (cb): (() => void) => {
    const listener: (e: IpcRendererEvent, ev: AiChunkEvent) => void = (_e, ev) => cb(ev)
    ipcRenderer.on(IpcChannels.evAiChunk, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evAiChunk, listener)
  },
  onAiDone: (cb): (() => void) => {
    const listener: (e: IpcRendererEvent, ev: AiDoneEvent) => void = (_e, ev) => cb(ev)
    ipcRenderer.on(IpcChannels.evAiDone, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evAiDone, listener)
  },
  aiChatStart: (request) => ipcRenderer.invoke(IpcChannels.aiChatStart, request),
  aiChatApprove: (requestId, callId, approved) =>
    ipcRenderer.send(IpcChannels.aiChatApprove, requestId, callId, approved),
  aiChatCancel: (requestId) => ipcRenderer.send(IpcChannels.aiChatCancel, requestId),
  aiChatReset: (sessionId) => ipcRenderer.send(IpcChannels.aiChatReset, sessionId),
  onAiChatEvent: (cb): (() => void) => {
    const listener: (e: IpcRendererEvent, ev: AiChatEvent) => void = (_e, ev) => cb(ev)
    ipcRenderer.on(IpcChannels.evAiChat, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evAiChat, listener)
  },
  sftpList: (connectionId, path) => ipcRenderer.invoke(IpcChannels.sftpList, connectionId, path),
  sftpMkdir: (connectionId, path) => ipcRenderer.invoke(IpcChannels.sftpMkdir, connectionId, path),
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
  onTransferProgress: (cb): (() => void) => {
    const listener: (e: IpcRendererEvent, ev: TransferProgressEvent) => void = (_e, ev) => cb(ev)
    ipcRenderer.on(IpcChannels.evTransferProgress, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evTransferProgress, listener)
  },
  onTransferDone: (cb): (() => void) => {
    const listener: (e: IpcRendererEvent, ev: TransferDoneEvent) => void = (_e, ev) => cb(ev)
    ipcRenderer.on(IpcChannels.evTransferDone, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evTransferDone, listener)
  },
  getPathForFile: (file) => webUtils.getPathForFile(file as File),
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
