import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { ConnectConfig } from 'ssh2'
import { ConnectionInput, ConnectionMeta } from '@shared/types'
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
    readyTimeout: meta.timeoutMs && meta.timeoutMs > 0 ? meta.timeoutMs : 15000,
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

/** 从未保存的表单输入构建连接配置；凭据字段留空时回退到已保存凭据（编辑场景）。 */
export async function buildConnectConfigFromInput(
  input: ConnectionInput,
  fallback: SecretPayload | null
): Promise<ConnectConfig> {
  const secret: SecretPayload = {}
  if (input.authType === 'password') {
    if (input.password) secret.password = input.password
    else if (fallback?.password) secret.password = fallback.password
  } else {
    if (input.privateKeyContent) secret.privateKeyContent = input.privateKeyContent
    else if (input.privateKeyFile) secret.privateKeyFile = input.privateKeyFile
    else if (fallback?.privateKeyContent) secret.privateKeyContent = fallback.privateKeyContent
    else if (fallback?.privateKeyFile) secret.privateKeyFile = fallback.privateKeyFile
    if (input.passphrase) secret.passphrase = input.passphrase
    else if (fallback?.passphrase) secret.passphrase = fallback.passphrase
  }
  const meta: ConnectionMeta = {
    id: 'test',
    name: input.name,
    groupId: input.groupId ?? null,
    host: input.host,
    port: input.port,
    username: input.username,
    authType: input.authType,
    remark: input.remark ?? '',
    color: input.color ?? '#10b981',
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    timeoutMs: input.timeoutMs ?? null
  }
  return buildConnectConfig(meta, secret)
}
