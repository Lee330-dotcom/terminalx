import { join } from 'path'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '@shared/types'
import { SettingsStore } from './store/settingsStore'
import { CredentialVault } from './store/credentialVault'
import { ConnectionStore } from './store/connectionStore'
import { SafeStorageProtector } from './safeStorageProtector'
import { ConnectionManager } from './ssh/connectionManager'
import { SessionManager, SessionEventSink } from './ssh/sessionManager'
import { SftpService, TransferEventSink } from './ssh/sftpService'
import { buildConnectConfig } from './ssh/config'

/** 应用级单例：存储与服务的统一入口。 */
export class AppContext {
  readonly settings: SettingsStore
  readonly vault: CredentialVault
  readonly connections: ConnectionStore
  readonly ssh: ConnectionManager
  readonly sessions: SessionManager
  readonly sftp: SftpService

  constructor(userDataDir: string) {
    this.settings = new SettingsStore(join(userDataDir, 'settings.json'))
    this.vault = new CredentialVault(join(userDataDir, 'credentials.enc'), new SafeStorageProtector())
    this.connections = new ConnectionStore(join(userDataDir, 'connections.json'), this.vault)

    this.ssh = new ConnectionManager(async (connectionId) => {
      const meta = (await this.connections.listConnections()).find((c) => c.id === connectionId)
      if (!meta) throw new Error(`连接不存在: ${connectionId}`)
      return buildConnectConfig(meta, await this.connections.getSecret(connectionId))
    })

    const sink: SessionEventSink = {
      emitData: (sessionId, data) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IpcChannels.evSessionData, { sessionId, data })
        }
      },
      emitStatus: (sessionId, status, errorMessage) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IpcChannels.evSessionStatus, { sessionId, status, errorMessage })
        }
      }
    }
    this.sessions = new SessionManager(this.ssh, sink)

    const transferSink: TransferEventSink = {
      emitProgress: (ev) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IpcChannels.evTransferProgress, ev)
        }
      },
      emitDone: (ev) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IpcChannels.evTransferDone, ev)
        }
      }
    }
    this.sftp = new SftpService(this.ssh, transferSink)
  }
}
