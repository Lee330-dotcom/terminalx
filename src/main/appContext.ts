import { join } from 'path'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '@shared/types'
import { SettingsStore } from './store/settingsStore'
import { CredentialVault } from './store/credentialVault'
import { ConnectionStore } from './store/connectionStore'
import { SafeStorageProtector } from './safeStorageProtector'
import { ConnectionManager } from './ssh/connectionManager'
import { SessionManager, SessionEventSink } from './ssh/sessionManager'
import { AiService } from './ai/aiService'
import { AgentService } from './ai/agentService'
import { SftpService, TransferEventSink } from './ssh/sftpService'
import { McpService } from './mcp/mcpService'
import { buildConnectConfig } from './ssh/config'

/** 应用级单例：存储与服务的统一入口。 */
export class AppContext {
  readonly settings: SettingsStore
  readonly vault: CredentialVault
  readonly connections: ConnectionStore
  readonly ssh: ConnectionManager
  readonly sessions: SessionManager
  readonly sftp: SftpService
  readonly ai: AiService
  readonly agent: AgentService
  readonly mcp: McpService

  constructor(userDataDir: string) {
    this.settings = new SettingsStore(join(userDataDir, 'settings.json'))
    this.vault = new CredentialVault(
      join(userDataDir, 'credentials.enc'),
      new SafeStorageProtector()
    )
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
        if (status !== 'connected') this.agent?.reset(sessionId)
      }
    }
    this.sessions = new SessionManager(this.ssh, sink, async (connectionId) => {
      const meta = (await this.connections.listConnections()).find((c) => c.id === connectionId)
      return meta ? { name: meta.name } : null
    })

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

    this.ai = new AiService(
      {
        settings: this.settings,
        vault: this.vault,
        connections: this.connections,
        sessions: this.sessions
      },
      {
        emitChunk: (ev) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IpcChannels.evAiChunk, ev)
          }
        },
        emitDone: (ev) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IpcChannels.evAiDone, ev)
          }
        }
      }
    )

    this.agent = new AgentService(
      {
        settings: this.settings,
        vault: this.vault,
        sessions: this.sessions,
        connections: this.connections,
        exec: (connectionId, command, timeoutMs) => this.ssh.exec(connectionId, command, timeoutMs)
      },
      {
        emit: (ev) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IpcChannels.evAiChat, ev)
          }
        }
      }
    )

    this.mcp = new McpService(this)
  }
}
