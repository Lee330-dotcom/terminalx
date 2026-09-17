import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ConnectionStore } from '../connectionStore'
import { CredentialVault, KeyProtector } from '../credentialVault'

const fakeProtector: KeyProtector = {
  encrypt: (data) => Buffer.from(data.toString('base64')),
  decrypt: (data) => Buffer.from(data.toString(), 'base64')
}

let dir: string
let store: ConnectionStore

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'ssh-tool-conn-'))
  const vault = new CredentialVault(join(dir, 'credentials.enc'), fakeProtector)
  store = new ConnectionStore(join(dir, 'connections.json'), vault)
})

describe('ConnectionStore', () => {
  it('创建连接后元数据文件不含密码字段', async () => {
    await store.createConnection({
      name: 'prod',
      groupId: null,
      host: '10.0.0.1',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'hunter2'
    })
    const raw = await fs.readFile(join(dir, 'connections.json'), 'utf8')
    expect(raw).not.toContain('hunter2')
    expect(raw).not.toMatch(/"password"\s*:/)
  })

  it('CRUD：创建/读取/更新/删除', async () => {
    const created = await store.createConnection({
      name: 'a',
      groupId: null,
      host: 'h1',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'p1'
    })
    expect((await store.listConnections()).length).toBe(1)

    await store.updateConnection(created.id, {
      name: 'a2',
      groupId: null,
      host: 'h2',
      port: 2222,
      username: 'u2',
      authType: 'password'
    })
    const updated = (await store.listConnections())[0]
    expect(updated.host).toBe('h2')
    expect(updated.port).toBe(2222)
    // 未提供密码时凭据保留
    expect((await store.getSecret(created.id))?.password).toBe('p1')

    await store.deleteConnection(created.id)
    expect(await store.listConnections()).toEqual([])
    expect(await store.getSecret(created.id)).toBeNull()
  })

  it('分组：删除含连接的分组后连接移至未分组', async () => {
    const group = await store.createGroup('prod组')
    const conn = await store.createConnection({
      name: 'c',
      groupId: group.id,
      host: 'h',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'p'
    })
    expect((await store.listConnections())[0].groupId).toBe(group.id)
    await store.deleteGroup(group.id)
    expect((await store.listGroups()).length).toBe(0)
    expect((await store.listConnections())[0].groupId).toBeNull()
    void conn
  })

  it('私钥认证：支持 keyContent 与 keyFile 两种来源', async () => {
    const c1 = await store.createConnection({
      name: 'k1',
      groupId: null,
      host: 'h',
      port: 22,
      username: 'u',
      authType: 'privateKey',
      privateKeyContent: 'KEY-DATA'
    })
    const c2 = await store.createConnection({
      name: 'k2',
      groupId: null,
      host: 'h',
      port: 22,
      username: 'u',
      authType: 'privateKey',
      privateKeyFile: '/Users/me/.ssh/id_rsa',
      passphrase: 'ph'
    })
    expect((await store.getSecret(c1.id))?.privateKeyContent).toBe('KEY-DATA')
    const s2 = await store.getSecret(c2.id)
    expect(s2?.privateKeyFile).toBe('/Users/me/.ssh/id_rsa')
    expect(s2?.passphrase).toBe('ph')
  })

  it('更新连接时切换认证类型会写入新类型凭据', async () => {
    const conn = await store.createConnection({
      name: 'x',
      groupId: null,
      host: 'h',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'old'
    })
    await store.updateConnection(conn.id, {
      name: 'x',
      groupId: null,
      host: 'h',
      port: 22,
      username: 'u',
      authType: 'privateKey',
      privateKeyContent: 'NEW-KEY'
    })
    const secret = await store.getSecret(conn.id)
    expect(secret?.privateKeyContent).toBe('NEW-KEY')
    expect(secret?.password).toBeUndefined()
  })

  it('listConnectionsWithStatus 附加在线状态', async () => {
    const conn = await store.createConnection({
      name: 'x',
      groupId: null,
      host: 'h',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'p'
    })
    const list = await store.listConnectionsWithStatus((id) => id === conn.id)
    expect(list[0].online).toBe(true)
  })
})
