export type CommandRisk = 'low' | 'medium' | 'high' | 'unknown'

export interface LocalRisk {
  level: Exclude<CommandRisk, 'low' | 'unknown'>
  reason: string
}

export interface CommandSuggestion {
  command: string
  note: string
  risk: CommandRisk
  localRisk: LocalRisk | null
}

const RISK_RANK: Record<CommandRisk, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3
}

const RISK_LABELS: Record<string, CommandRisk> = {
  低: 'low',
  中: 'medium',
  高: 'high'
}

interface RiskRule {
  pattern: RegExp
  level: LocalRisk['level']
  reason: string
}

const RISK_RULES: RiskRule[] = [
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r/,
    level: 'medium',
    reason: '递归强制删除'
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+(\/|\/\*|~|\$HOME)\s*$/,
    level: 'high',
    reason: '删除根目录或家目录'
  },
  { pattern: /\bmkfs(\.\w+)?\b|\bwipefs\b/, level: 'high', reason: '格式化文件系统' },
  { pattern: /\bdd\b[^\n]*\bof=\/dev\//, level: 'high', reason: '直接写入块设备' },
  {
    pattern: /\b(shutdown|reboot|halt|poweroff)\b|\binit\s+0\b/,
    level: 'high',
    reason: '关机或重启'
  },
  {
    pattern: /\bchmod\s+(-[a-zA-Z]+\s+)*777\s+\/|\bchmod\s+-R\s+777/,
    level: 'medium',
    reason: '开放全局写权限'
  },
  { pattern: /\bchown\s+-R\s+\S+\s+\/(\s|$)/, level: 'high', reason: '递归修改根目录属主' },
  {
    pattern: /\bDROP\s+(TABLE|DATABASE)\b|\bTRUNCATE\s+TABLE\b/i,
    level: 'high',
    reason: '破坏性数据库语句'
  },
  { pattern: /\bDELETE\s+FROM\b(?![^;]*\bWHERE\b)/i, level: 'high', reason: '无条件删除数据' },
  { pattern: /:\(\)\s*\{[^}]*\};\s*:/, level: 'high', reason: 'Fork 炸弹' },
  {
    pattern: /\biptables\s+-F\b|\bnft\s+flush\s+ruleset\b/,
    level: 'high',
    reason: '清空防火墙规则'
  },
  { pattern: />\s*\/dev\/sd[a-z]/, level: 'high', reason: '覆盖磁盘设备' },
  { pattern: /\bkill\s+-9\s+1\b/, level: 'high', reason: '杀死 init 进程' },
  {
    pattern: /\b(curl|wget)\b[^\n]*\|\s*(ba|z)?sh\b/,
    level: 'high',
    reason: '下载内容直接交给 shell 执行'
  },
  { pattern: /\bsystemctl\s+(stop|disable)\b/, level: 'medium', reason: '停止或禁用系统服务' },
  { pattern: /\bfind\b[^\n]*\s-delete\b/, level: 'medium', reason: '批量删除匹配文件' }
]

export function detectRiskyCommand(command: string): LocalRisk | null {
  let hit: LocalRisk | null = null
  for (const rule of RISK_RULES) {
    if (!rule.pattern.test(command)) continue
    if (!hit || RISK_RANK[rule.level] > RISK_RANK[hit.level]) {
      hit = { level: rule.level, reason: rule.reason }
    }
  }
  return hit
}

function mergeRisk(modelRisk: CommandRisk, localRisk: LocalRisk | null): CommandRisk {
  const local = localRisk?.level ?? 'unknown'
  return RISK_RANK[modelRisk] >= RISK_RANK[local] ? modelRisk : local
}

const FENCE_PATTERN = /```(bash|sh|shell)\s*\r?\n([\s\S]*?)```/gi

function tailLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .slice(-8)
    .map((line) => line.trim())
    .filter(Boolean)
}

function noteBefore(text: string): string {
  const lines = tailLines(text)
  for (let i = lines.length - 1; i >= 0; i--) {
    const heading = /^#{1,6}\s*(?:\d+[.、)]\s*)?(.+)$/.exec(lines[i])
    if (heading) return heading[1].trim()
  }
  return ''
}

function modelRiskBefore(text: string): CommandRisk {
  const lines = tailLines(text)
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /^风险\s*[：:]\s*(低|中|高)/.exec(lines[i])
    if (match) return RISK_LABELS[match[1]]
  }
  return 'unknown'
}

/** 从模型输出中提取 bash 代码块及其邻近的说明与风险标注。 */
export function parseCommandBlocks(text: string): CommandSuggestion[] {
  const suggestions: CommandSuggestion[] = []
  const seen = new Set<string>()
  FENCE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FENCE_PATTERN.exec(text)) !== null) {
    const command = match[2].trim()
    if (!command || seen.has(command)) continue
    seen.add(command)
    const before = text.slice(0, match.index)
    const localRisk = detectRiskyCommand(command)
    suggestions.push({
      command,
      note: noteBefore(before),
      risk: mergeRisk(modelRiskBefore(before), localRisk),
      localRisk
    })
    if (suggestions.length >= 3) break
  }
  return suggestions
}
