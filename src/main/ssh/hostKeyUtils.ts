import { createHash } from 'crypto'

/**
 * 主机公钥指纹相关的纯函数。
 *
 * 指纹口径与 OpenSSH 对齐：`SHA256:` + base64(SHA256(公钥 blob))（去掉末尾补位），
 * 与 `ssh-keygen -lf` 输出一致，因此可以直接与用户已有的 known_hosts 对照。
 */

/** ssh2 传入的公钥 blob：4 字节长度 + 密钥类型字符串 + 密钥材料 */
export function keyTypeOfKeyBlob(blob: Buffer): string {
  try {
    if (blob.length < 4) return 'unknown'
    const typeLength = blob.readUInt32BE(0)
    if (typeLength <= 0 || typeLength > blob.length - 4) return 'unknown'
    return blob.subarray(4, 4 + typeLength).toString('utf8')
  } catch {
    return 'unknown'
  }
}

/** 计算 `SHA256:` 指纹（与 `ssh-keygen -lf` 一致）。 */
export function fingerprintOfKeyBlob(blob: Buffer): string {
  const digest = createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
  return `SHA256:${digest}`
}

/** 指纹库键：`host:port`，端口省略时按 22 处理。 */
export function hostKeyId(host: string, port: number): string {
  return `${host}:${port}`
}

export interface KnownHostsEntry {
  host: string
  port: number
  keyType: string
  fingerprint: string
}

export interface KnownHostsParseResult {
  entries: KnownHostsEntry[]
  /** 带 @cert-authority / @revoked 标记或格式非法的行数 */
  skipped: number
}

/**
 * 解析 OpenSSH known_hosts 内容。
 *
 * 支持的行格式：`host[,host2...] keytype base64key`；
 * - `#` 开头为注释；带 `@cert-authority` / `@revoked` 标记的行跳过（本轮不实现证书信任语义）
 * - `[host]:port` 形式表示非默认端口；裸主机名按 22 端口处理
 * - 同一行多个主机名各自生成一条记录
 */
export function parseKnownHosts(content: string): KnownHostsParseResult {
  const entries: KnownHostsEntry[] = []
  let skipped = 0

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const parts = line.split(/\s+/)
    if (parts.length < 3) {
      skipped++
      continue
    }

    const hostsField = parts[0]
    if (hostsField.startsWith('@')) {
      // @cert-authority / @revoked：本轮不实现，跳过并计数
      skipped++
      continue
    }
    const keyType = parts[1]
    const keyBase64 = parts[2]
    if (!keyType || !keyBase64) {
      skipped++
      continue
    }

    let blob: Buffer
    try {
      blob = Buffer.from(keyBase64, 'base64')
    } catch {
      skipped++
      continue
    }
    if (blob.length === 0) {
      skipped++
      continue
    }

    const fingerprint = fingerprintOfKeyBlob(blob)
    for (const hostField of hostsField.split(',')) {
      const parsed = parseKnownHostsHost(hostField)
      if (!parsed) {
        skipped++
        continue
      }
      entries.push({
        host: parsed.host,
        port: parsed.port,
        keyType,
        fingerprint
      })
    }
  }

  return { entries, skipped }
}

/** 解析 known_hosts 的主机字段：`host` 或 `[host]:port`。 */
export function parseKnownHostsHost(field: string): { host: string; port: number } | null {
  const trimmed = field.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('[')) {
    const match = /^\[([^\]]+)\]:(\d+)$/.exec(trimmed)
    if (!match) return null
    const port = Number.parseInt(match[2], 10)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
    return { host: match[1], port }
  }
  return { host: trimmed, port: 22 }
}
