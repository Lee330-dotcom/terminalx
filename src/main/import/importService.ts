import { randomUUID } from 'crypto'

/**
 * 批量导入解析层：把外部 CSV 转成可写入的连接条目。
 * 纯函数，不依赖 Electron，便于单测。
 */

export type ImportKind = 'bastion' | 'template'

export interface ImportRow {
  name: string
  host: string
  port: number
  username: string
  remark: string
}

export interface ImportPreview {
  ok: boolean
  error?: string
  kind: ImportKind
  /** 通过校验且不与已有连接重复的行 */
  rows: ImportRow[]
  /** 文件里的数据行总数（不含表头与空行） */
  total: number
  /** 与已有连接重复、将被跳过的行数 */
  duplicates: number
  /** 字段缺失或非法、无法导入的行数 */
  invalid: number
  /** 预览用的前几条连接名 */
  samples: string[]
}

/** 齐治堡垒机「导出透传访问配置」的 Xshell.csv 列序（无表头） */
const BASTION_MIN_COLUMNS = 5

/** 模板导入要求的表头 */
export const TEMPLATE_HEADER = ['name', 'host', 'port', 'username', 'remark']

/**
 * 解析单行 CSV，支持双引号包裹与 "" 转义。
 * 堡垒机导出的 username 含 `/`，模板 remark 可能含逗号，都不能用简单 split(',')。
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
        continue
      }
      current += c
      continue
    }
    if (c === '"') {
      inQuotes = true
      continue
    }
    if (c === ',') {
      fields.push(current)
      current = ''
      continue
    }
    current += c
  }
  fields.push(current)
  return fields.map((f) => f.trim())
}

function splitLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '')
}

function validPort(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 22
}

/** 堡垒机透传导入：第 1 列名称、第 2 列堡垒机地址、第 4 列端口、第 5 列「工号/目标IP/用户名」整串。 */
export function parseBastionCsv(text: string): { rows: ImportRow[]; invalid: number } {
  const rows: ImportRow[] = []
  let invalid = 0
  for (const line of splitLines(text)) {
    const cols = parseCsvLine(line)
    if (cols.length < BASTION_MIN_COLUMNS) {
      invalid++
      continue
    }
    const [displayName, host, , portRaw, account] = cols
    if (!host || !account) {
      invalid++
      continue
    }
    const targetIp = account.split('/')[1] ?? ''
    rows.push({
      name: displayName || account,
      host,
      port: validPort(portRaw),
      username: account,
      remark: targetIp ? `透传目标 ${targetIp}` : ''
    })
  }
  return { rows, invalid }
}

/** 模板导入：首行表头 name,host,port,username,remark，列序可变、remark 可缺省。 */
export function parseTemplateCsv(text: string): { rows: ImportRow[]; invalid: number } {
  const lines = splitLines(text)
  if (lines.length === 0) return { rows: [], invalid: 0 }
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase())
  const index = (key: string): number => header.indexOf(key)
  const required = ['name', 'host', 'username']
  if (required.some((k) => index(k) < 0)) {
    throw new Error(`模板表头缺少必需列，要求包含 ${TEMPLATE_HEADER.join('、')}`)
  }
  const rows: ImportRow[] = []
  let invalid = 0
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line)
    const name = cols[index('name')] ?? ''
    const host = cols[index('host')] ?? ''
    const username = cols[index('username')] ?? ''
    if (!name || !host || !username) {
      invalid++
      continue
    }
    const portIdx = index('port')
    const remarkIdx = index('remark')
    rows.push({
      name,
      host,
      port: validPort(portIdx >= 0 ? cols[portIdx] : undefined),
      username,
      remark: remarkIdx >= 0 ? (cols[remarkIdx] ?? '') : ''
    })
  }
  return { rows, invalid }
}

/**
 * 生成导入预览：解析 + 与已有连接去重。
 * 堡垒机以 username 整串为唯一键（它含目标 IP，同 host 下天然区分机器）；
 * 模板以 host+port+username 为键。
 */
export function buildPreview(
  kind: ImportKind,
  text: string,
  existing: Array<{ host: string; port: number; username: string }>
): ImportPreview {
  const base = { kind, total: 0, duplicates: 0, invalid: 0, samples: [] as string[] }
  let parsed: { rows: ImportRow[]; invalid: number }
  try {
    parsed = kind === 'bastion' ? parseBastionCsv(text) : parseTemplateCsv(text)
  } catch (err) {
    return { ...base, ok: false, error: String(err instanceof Error ? err.message : err), rows: [] }
  }
  const keyOf = (r: { host: string; port: number; username: string }): string =>
    kind === 'bastion' ? r.username : `${r.host}:${r.port}:${r.username}`
  const seen = new Set(existing.map(keyOf))
  const rows = parsed.rows.filter((r) => {
    if (seen.has(keyOf(r))) {
      base.duplicates++
      return false
    }
    seen.add(keyOf(r))
    return true
  })
  base.invalid = parsed.invalid
  base.total = parsed.rows.length + parsed.invalid
  base.samples = rows.slice(0, 3).map((r) => r.name)
  return { ...base, ok: true, rows }
}

/** 预览结果转成 ConnectionStore 需要的输入形状。 */
export function toConnectionInputs(
  preview: ImportPreview,
  groupId: string | null,
  password: string | null
): Array<import('@shared/types').ConnectionInput> {
  return preview.rows.map((row) => ({
    name: row.name,
    groupId,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: 'password' as const,
    ...(password ? { password } : {}),
    remark: row.remark,
    color: '#10b981'
  }))
}

/** 供单测构造稳定 id；生产路径由 ConnectionStore 生成 uuid。 */
export function newId(): string {
  return randomUUID()
}
