import { randomUUID } from 'crypto'
import {
  ConnectionGroup,
  ConnectionInput,
  ConnectionMeta,
  ConnectionWithStatus,
  AuthType
} from '@shared/types'
import { readJson, writeJsonAtomic } from './jsonFile'
import { CredentialVault, SecretPayload } from './credentialVault'

interface ConnectionsFile {
  connections: ConnectionMeta[]
  groups: ConnectionGroup[]
}

export class ConnectionStore {
  constructor(
    private readonly metaFile: string,
    private readonly vault: CredentialVault
  ) {}

  private async load(): Promise<ConnectionsFile> {
    return readJson<ConnectionsFile>(this.metaFile, { connections: [], groups: [] })
  }

  private async save(data: ConnectionsFile): Promise<void> {
    await writeJsonAtomic(this.metaFile, data)
  }

  async listConnections(): Promise<ConnectionMeta[]> {
    const data = await this.load()
    return data.connections
  }

  async listGroups(): Promise<ConnectionGroup[]> {
    const data = await this.load()
    return [...data.groups].sort((a, b) => a.order - b.order)
  }

  async createConnection(input: ConnectionInput): Promise<ConnectionMeta> {
    const data = await this.load()
    const now = Date.now()
    const meta: ConnectionMeta = {
      id: randomUUID(),
      name: input.name,
      groupId: input.groupId ?? null,
      host: input.host,
      port: input.port,
      username: input.username,
      authType: input.authType,
      remark: input.remark ?? '',
      color: input.color ?? '#409eff',
      createdAt: now,
      updatedAt: now
    }
    data.connections.push(meta)
    await this.save(data)
    await this.saveSecret(meta.id, input)
    return meta
  }

  async updateConnection(id: string, input: ConnectionInput): Promise<ConnectionMeta> {
    const data = await this.load()
    const idx = data.connections.findIndex((c) => c.id === id)
    if (idx < 0) throw new Error(`connection not found: ${id}`)
    const prev = data.connections[idx]
    const meta: ConnectionMeta = {
      ...prev,
      name: input.name,
      groupId: input.groupId ?? null,
      host: input.host,
      port: input.port,
      username: input.username,
      authType: input.authType,
      remark: input.remark ?? '',
      color: input.color ?? prev.color,
      updatedAt: Date.now()
    }
    data.connections[idx] = meta
    await this.save(data)
    await this.saveSecret(meta.id, input)
    return meta
  }

  /** 仅当输入包含凭据字段时更新凭据；authType 变更时清空旧类型凭据。 */
  private async saveSecret(id: string, input: ConnectionInput): Promise<void> {
    const secret: SecretPayload = {}
    if (input.authType === 'password') {
      if (input.password != null) secret.password = input.password
    } else {
      if (input.privateKeyContent != null) secret.privateKeyContent = input.privateKeyContent
      if (input.privateKeyFile != null) secret.privateKeyFile = input.privateKeyFile
      if (input.passphrase != null) secret.passphrase = input.passphrase
    }
    if (Object.keys(secret).length > 0) {
      await this.vault.set(id, secret)
    }
  }

  async deleteConnection(id: string): Promise<void> {
    const data = await this.load()
    data.connections = data.connections.filter((c) => c.id !== id)
    await this.save(data)
    await this.vault.delete(id)
  }

  async getSecret(id: string): Promise<SecretPayload | null> {
    return this.vault.get(id)
  }

  async listConnectionsWithStatus(
    isOnline: (id: string) => boolean
  ): Promise<ConnectionWithStatus[]> {
    const connections = await this.listConnections()
    return connections.map((c) => ({ ...c, online: isOnline(c.id) }))
  }

  async createGroup(name: string): Promise<ConnectionGroup> {
    const data = await this.load()
    const group: ConnectionGroup = {
      id: randomUUID(),
      name,
      order: data.groups.length
    }
    data.groups.push(group)
    await this.save(data)
    return group
  }

  async updateGroup(id: string, name: string): Promise<ConnectionGroup> {
    const data = await this.load()
    const group = data.groups.find((g) => g.id === id)
    if (!group) throw new Error(`group not found: ${id}`)
    group.name = name
    await this.save(data)
    return group
  }

  /** 删除分组，组内连接移至未分组。 */
  async deleteGroup(id: string): Promise<void> {
    const data = await this.load()
    data.groups = data.groups.filter((g) => g.id !== id)
    for (const conn of data.connections) {
      if (conn.groupId === id) conn.groupId = null
    }
    await this.save(data)
  }
}
