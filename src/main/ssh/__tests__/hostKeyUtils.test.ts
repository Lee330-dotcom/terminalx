import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import {
  fingerprintOfKeyBlob,
  hostKeyId,
  keyTypeOfKeyBlob,
  parseKnownHosts,
  parseKnownHostsHost
} from '../hostKeyUtils'

/** 构造一个与 ssh2 hostVerifier 相同格式的公钥 blob：4 字节长度 + 类型 + 材料。 */
function makeKeyBlob(keyType: string, material = 'test-key-material'): Buffer {
  const typeBuf = Buffer.from(keyType, 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(typeBuf.length, 0)
  return Buffer.concat([len, typeBuf, Buffer.from(material, 'utf8')])
}

describe('keyTypeOfKeyBlob', () => {
  it('读取 blob 中的密钥类型', () => {
    expect(keyTypeOfKeyBlob(makeKeyBlob('ssh-ed25519'))).toBe('ssh-ed25519')
    expect(keyTypeOfKeyBlob(makeKeyBlob('ssh-rsa'))).toBe('ssh-rsa')
  })

  it('blob 非法时返回 unknown 而不是抛错', () => {
    expect(keyTypeOfKeyBlob(Buffer.alloc(0))).toBe('unknown')
    expect(keyTypeOfKeyBlob(Buffer.from([0, 0, 0, 200]))).toBe('unknown')
  })
})

describe('fingerprintOfKeyBlob', () => {
  it('与 ssh-keygen -lf 口径一致：SHA256: + base64(sha256(blob)) 去掉补位', () => {
    const blob = makeKeyBlob('ssh-ed25519')
    const expected = createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
    expect(fingerprintOfKeyBlob(blob)).toBe(`SHA256:${expected}`)
  })

  it('相同 blob 得到相同指纹，不同 blob 得到不同指纹', () => {
    const a = makeKeyBlob('ssh-ed25519', 'a')
    const b = makeKeyBlob('ssh-ed25519', 'b')
    expect(fingerprintOfKeyBlob(a)).toBe(fingerprintOfKeyBlob(a))
    expect(fingerprintOfKeyBlob(a)).not.toBe(fingerprintOfKeyBlob(b))
  })

  it('指纹不含 base64 补位等号', () => {
    expect(fingerprintOfKeyBlob(makeKeyBlob('ssh-rsa'))).not.toMatch(/=+$/)
  })
})

describe('hostKeyId', () => {
  it('按 host:port 生成唯一标识', () => {
    expect(hostKeyId('10.0.0.1', 22)).toBe('10.0.0.1:22')
    expect(hostKeyId('10.0.0.1', 22)).not.toBe(hostKeyId('10.0.0.1', 2222))
  })
})

describe('parseKnownHostsHost', () => {
  it('裸主机名按 22 端口处理', () => {
    expect(parseKnownHostsHost('example.com')).toEqual({ host: 'example.com', port: 22 })
  })

  it('解析 [host]:port 形式', () => {
    expect(parseKnownHostsHost('[example.com]:2222')).toEqual({ host: 'example.com', port: 2222 })
  })

  it('非法主机字段返回 null', () => {
    expect(parseKnownHostsHost('')).toBeNull()
    expect(parseKnownHostsHost('[example.com]')).toBeNull()
    expect(parseKnownHostsHost('[example.com]:abc')).toBeNull()
    expect(parseKnownHostsHost('[example.com]:99999')).toBeNull()
  })
})

describe('parseKnownHosts', () => {
  const blob = makeKeyBlob('ssh-ed25519', 'known-host-material')
  const keyBase64 = blob.toString('base64')
  const fingerprint = fingerprintOfKeyBlob(blob)

  it('解析标准 known_hosts 行并算出指纹', () => {
    const res = parseKnownHosts(`example.com ssh-ed25519 ${keyBase64}\n`)
    expect(res.entries).toHaveLength(1)
    expect(res.entries[0]).toEqual({
      host: 'example.com',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint
    })
    expect(res.skipped).toBe(0)
  })

  it('同一行多个主机名各自生成一条记录', () => {
    const res = parseKnownHosts(`a.com,b.com ssh-ed25519 ${keyBase64}\n`)
    expect(res.entries.map((e) => e.host)).toEqual(['a.com', 'b.com'])
  })

  it('解析非默认端口', () => {
    const res = parseKnownHosts(`[example.com]:2222 ssh-ed25519 ${keyBase64}\n`)
    expect(res.entries[0].host).toBe('example.com')
    expect(res.entries[0].port).toBe(2222)
  })

  it('跳过注释、空行与 @cert-authority / @revoked 标记行并计数', () => {
    const content = [
      '# 这是注释',
      '',
      `@cert-authority *.corp.com ssh-ed25519 ${keyBase64}`,
      `@revoked example.com ssh-ed25519 ${keyBase64}`
    ].join('\n')
    const res = parseKnownHosts(content)
    expect(res.entries).toHaveLength(0)
    expect(res.skipped).toBe(2)
  })

  it('字段不足的行被跳过并计数', () => {
    const res = parseKnownHosts('example.com ssh-ed25519\n')
    expect(res.entries).toHaveLength(0)
    expect(res.skipped).toBe(1)
  })
})
