import { describe, it, expect, beforeEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HostKeyStore } from '../../store/hostKeyStore'
import { HostKeyGate, HostKeyPromptRequest } from '../hostKeyGate'
import { fingerprintOfKeyBlob, keyTypeOfKeyBlob } from '../hostKeyUtils'

function makeKeyBlob(keyType: string, material: string): Buffer {
  const typeBuf = Buffer.from(keyType, 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(typeBuf.length, 0)
  return Buffer.concat([len, typeBuf, Buffer.from(material, 'utf8')])
}

let dir: string
let store: HostKeyStore
let requests: HostKeyPromptRequest[]
let gate: HostKeyGate

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'terminalx-hostkeygate-'))
  store = new HostKeyStore(join(dir, 'hostKeys.json'))
  requests = []
  gate = new HostKeyGate(store, (req) => requests.push(req), { timeoutMs: 200 })
})

describe('HostKeyGate', () => {
  it('首次连接触发确认请求，用户信任后写入指纹库并放行', async () => {
    const blob = makeKeyBlob('ssh-ed25519', 'k1')
    const p = gate.verify('h', 22, blob)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].status).toBe('new')
    expect(requests[0].fingerprint).toBe(fingerprintOfKeyBlob(blob))
    expect(requests[0].keyType).toBe(keyTypeOfKeyBlob(blob))

    gate.respond(requests[0].requestId, true)
    await expect(p).resolves.toBeUndefined()
    expect((await store.get('h', 22))?.fingerprint).toBe(fingerprintOfKeyBlob(blob))
  })

  it('指纹一致时静默放行，不打扰用户', async () => {
    const blob = makeKeyBlob('ssh-ed25519', 'k1')
    await store.trust('h', 22, fingerprintOfKeyBlob(blob), 'ssh-ed25519')
    await expect(gate.verify('h', 22, blob)).resolves.toBeUndefined()
    expect(requests).toHaveLength(0)
  })

  it('指纹不一致时以 changed 状态告警，确认后覆盖旧记录', async () => {
    const old = makeKeyBlob('ssh-ed25519', 'k1')
    const next = makeKeyBlob('ssh-ed25519', 'k2')
    await store.trust('h', 22, fingerprintOfKeyBlob(old), 'ssh-ed25519')

    const p = gate.verify('h', 22, next)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].status).toBe('changed')
    expect(requests[0].storedFingerprint).toBe(fingerprintOfKeyBlob(old))
    expect(requests[0].fingerprint).toBe(fingerprintOfKeyBlob(next))

    gate.respond(requests[0].requestId, true)
    await expect(p).resolves.toBeUndefined()
    expect((await store.get('h', 22))?.fingerprint).toBe(fingerprintOfKeyBlob(next))
  })

  it('用户拒绝时抛出带原因的错误且不写入指纹库', async () => {
    const blob = makeKeyBlob('ssh-ed25519', 'k1')
    const p = gate.verify('h', 22, blob)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    gate.respond(requests[0].requestId, false)
    await expect(p).rejects.toThrow(/用户拒绝了主机指纹/)
    expect(await store.get('h', 22)).toBeNull()
  })

  it('指纹变更被拒绝时错误信息说明不一致', async () => {
    const old = makeKeyBlob('ssh-ed25519', 'k1')
    const next = makeKeyBlob('ssh-ed25519', 'k2')
    await store.trust('h', 22, fingerprintOfKeyBlob(old), 'ssh-ed25519')
    const p = gate.verify('h', 22, next)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    gate.respond(requests[0].requestId, false)
    await expect(p).rejects.toThrow(/不一致/)
  })

  it('同一主机的并发握手共享一次确认', async () => {
    const blob = makeKeyBlob('ssh-ed25519', 'k1')
    const p1 = gate.verify('h', 22, blob)
    const p2 = gate.verify('h', 22, blob)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(gate.pendingCount).toBe(1)
    gate.respond(requests[0].requestId, true)
    await expect(p1).resolves.toBeUndefined()
    await expect(p2).resolves.toBeUndefined()
    expect(requests).toHaveLength(1)
  })

  it('不同主机各自弹出确认', async () => {
    const blob = makeKeyBlob('ssh-ed25519', 'k1')
    const p1 = gate.verify('h1', 22, blob)
    const p2 = gate.verify('h2', 22, blob)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(gate.pendingCount).toBe(2)
    gate.respond(requests[0].requestId, true)
    gate.respond(requests[1].requestId, true)
    await expect(p1).resolves.toBeUndefined()
    await expect(p2).resolves.toBeUndefined()
  })

  it('超时未应答视为拒绝', async () => {
    const blob = makeKeyBlob('ssh-ed25519', 'k1')
    const p = gate.verify('h', 22, blob)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await expect(p).rejects.toThrow(/用户拒绝了主机指纹/)
    expect(gate.pendingCount).toBe(0)
  })

  it('对未知 requestId 应答不产生副作用', async () => {
    const blob = makeKeyBlob('ssh-ed25519', 'k1')
    const p = gate.verify('h', 22, blob)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    gate.respond('not-a-real-id', true)
    expect(gate.pendingCount).toBe(1)
    gate.respond(requests[0].requestId, true)
    await expect(p).resolves.toBeUndefined()
  })
})
