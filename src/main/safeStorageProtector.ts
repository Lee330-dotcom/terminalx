import { safeStorage } from 'electron'
import { KeyProtector } from './store/credentialVault'

/** 生产环境用 Electron safeStorage（macOS Keychain 托管）保护主密钥。 */
export class SafeStorageProtector implements KeyProtector {
  encrypt(data: Buffer): Buffer {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this system')
    }
    return safeStorage.encryptString(data.toString('base64'))
  }

  decrypt(data: Buffer): Buffer {
    return Buffer.from(safeStorage.decryptString(data), 'base64')
  }
}
