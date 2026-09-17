import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CredentialVault, KeyProtector } from '../credentialVault'

// 测试用 protector：base64 编解码，可逆且无加密强度，仅验证流程。
const fakeProtector: KeyProtector = {
  encrypt: (data) => Buffer.from(data.toString('base64')),
  decrypt: (data) => Buffer.from(data.toString(), 'base64')
}

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'ssh-tool-vault-'))
  file = join(dir, 'credentials.enc')
})

function newVault(): CredentialVault {
  return new CredentialVault(file, fakeProtector)
}

describe('CredentialVault', () => {
  it('加密后密文文件不含明文密码', async () => {
    const vault = newVault()
    await vault.set('conn-1', { password: 'SuperSecret123' })
    const contains = await vault.rawFileContains('SuperSecret123')
    expect(contains).toBe(false)
    const raw = await fs.readFile(file, 'utf8')
    expect(raw).toContain('"secrets"')
  })

  it('解密还原一致', async () => {
    const vault = newVault()
    await vault.set('conn-1', {
      password: 'p@ss',
      privateKeyContent: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END-----',
      passphrase: 'phrase'
    })
    const secret = await vault.get('conn-1')
    expect(secret).toEqual({
      password: 'p@ss',
      privateKeyContent: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END-----',
      passphrase: 'phrase'
    })
  })

  it('重启（新实例重新加载密钥）后仍可解密', async () => {
    const vault1 = newVault()
    await vault1.set('conn-1', { password: 'persist-me' })
    const vault2 = newVault()
    const secret = await vault2.get('conn-1')
    expect(secret?.password).toBe('persist-me')
  })

  it('delete 后凭据不可读且密文移除', async () => {
    const vault = newVault()
    await vault.set('conn-1', { password: 'gone' })
    await vault.delete('conn-1')
    expect(await vault.get('conn-1')).toBeNull()
    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain('conn-1')
  })

  it('密文不落盘主密钥（protector 之外的密钥不出现）', async () => {
    // 捕获 encrypt 收到的原始主密钥，验证它不会以 base64 明文出现在文件中
    let capturedMaster: Buffer | null = null
    const capturing: KeyProtector = {
      encrypt: (data) => {
        capturedMaster = data
        return Buffer.from(data.toString('base64'))
      },
      decrypt: (data) => Buffer.from(data.toString(), 'base64')
    }
    const vault = new CredentialVault(file, capturing)
    await vault.set('conn-1', { password: 'x' })
    expect(capturedMaster).not.toBeNull()
    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain(capturedMaster!.toString('base64'))
  })
})
