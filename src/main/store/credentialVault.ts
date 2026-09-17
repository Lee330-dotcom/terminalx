import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { promises as fs } from 'fs'
import { dirname } from 'path'
import { readJson, writeJsonAtomic } from './jsonFile'

export interface KeyProtector {
  encrypt(data: Buffer): Buffer
  decrypt(data: Buffer): Buffer
}

interface VaultFile {
  version: 1
  /** base64 密文，主密钥经 KeyProtector 加密后的形态 */
  wrappedKey: string
  /** key: connectionId, value: 明文 JSON 序列化后用主密钥 AES-256-GCM 加密的密文 */
  secrets: Record<string, string>
}

export interface SecretPayload {
  password?: string
  privateKeyContent?: string
  privateKeyFile?: string
  passphrase?: string
}

/**
 * 凭据库：主密钥（32B）随机生成，用 KeyProtector（生产环境为 Electron
 * safeStorage，即 macOS Keychain 托管）加密后落盘；各凭据用主密钥
 * AES-256-GCM 加密。本类不依赖 electron，可单测。
 */
export class CredentialVault {
  private wrappedKey?: Buffer
  private masterKey?: Buffer
  private secrets: Record<string, string> = {}
  private loaded = false

  constructor(
    private readonly file: string,
    private readonly protector: KeyProtector
  ) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    const vault = await readJson<VaultFile | null>(this.file, null)
    if (vault && vault.wrappedKey) {
      this.wrappedKey = Buffer.from(vault.wrappedKey, 'base64')
      this.masterKey = this.protector.decrypt(this.wrappedKey)
      this.secrets = vault.secrets ?? {}
    } else {
      this.masterKey = randomBytes(32)
      this.wrappedKey = this.protector.encrypt(this.masterKey)
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    if (!this.wrappedKey) throw new Error('vault not loaded')
    const vault: VaultFile = {
      version: 1,
      wrappedKey: this.wrappedKey.toString('base64'),
      secrets: this.secrets
    }
    await writeJsonAtomic(this.file, vault)
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.masterKey!, iv)
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, enc]).toString('base64')
  }

  private decrypt(encoded: string): string {
    const buf = Buffer.from(encoded, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey!, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  }

  async set(connectionId: string, secret: SecretPayload): Promise<void> {
    await this.ensureLoaded()
    const plain = JSON.stringify(secret)
    this.secrets[connectionId] = this.encrypt(plain)
    await this.persist()
  }

  async get(connectionId: string): Promise<SecretPayload | null> {
    await this.ensureLoaded()
    const encoded = this.secrets[connectionId]
    if (!encoded) return null
    return JSON.parse(this.decrypt(encoded)) as SecretPayload
  }

  async delete(connectionId: string): Promise<void> {
    await this.ensureLoaded()
    if (!(connectionId in this.secrets)) return
    delete this.secrets[connectionId]
    await this.persist()
  }

  /** 验证落盘内容不含任何明文凭据（供测试与安全检查使用）。 */
  async rawFileContains(plaintext: string): Promise<boolean> {
    const raw = await fs.readFile(this.file, 'utf8').catch(() => '')
    return raw.includes(plaintext)
  }

  static async initDir(file: string): Promise<void> {
    await fs.mkdir(dirname(file), { recursive: true })
  }
}
