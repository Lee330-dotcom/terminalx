import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { ConnectConfig } from 'ssh2'
import { ConnectionMeta } from '@shared/types'
import { SecretPayload } from '../store/credentialVault'

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return resolve(p)
}

export async function buildConnectConfig(
  meta: ConnectionMeta,
  secret: SecretPayload | null
): Promise<ConnectConfig> {
  const config: ConnectConfig = {
    host: meta.host,
    port: meta.port,
    username: meta.username,
    readyTimeout: 15000,
    keepaliveInterval: 30000,
    keepaliveCountMax: 3
  }
  if (meta.authType === 'password') {
    if (!secret?.password) throw new Error('缺少密码，请编辑连接补全凭据')
    config.password = secret.password
  } else {
    if (secret?.privateKeyContent) {
      config.privateKey = secret.privateKeyContent
    } else if (secret?.privateKeyFile) {
      config.privateKey = await fs.readFile(expandHome(secret.privateKeyFile), 'utf8')
    } else {
      throw new Error('缺少私钥，请编辑连接补全凭据')
    }
    if (secret?.passphrase) config.passphrase = secret.passphrase
  }
  return config
}
