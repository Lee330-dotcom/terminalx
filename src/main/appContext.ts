import { join } from 'path'
import { SettingsStore } from './store/settingsStore'
import { CredentialVault } from './store/credentialVault'
import { ConnectionStore } from './store/connectionStore'
import { SafeStorageProtector } from './safeStorageProtector'

/** 应用级单例：存储与后续服务（连接管理器、MCP server）的统一入口。 */
export class AppContext {
  readonly settings: SettingsStore
  readonly vault: CredentialVault
  readonly connections: ConnectionStore

  constructor(userDataDir: string) {
    this.settings = new SettingsStore(join(userDataDir, 'settings.json'))
    this.vault = new CredentialVault(join(userDataDir, 'credentials.enc'), new SafeStorageProtector())
    this.connections = new ConnectionStore(join(userDataDir, 'connections.json'), this.vault)
  }
}
