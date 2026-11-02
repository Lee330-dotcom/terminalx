import { CommandRiskLevel } from '@shared/types'

export type CommandVerdict = 'auto' | 'confirm' | 'reject'

export interface CommandDecision {
  verdict: CommandVerdict
  risk: CommandRiskLevel
  reason: string
}

export const MAX_COMMAND_LENGTH = 2000

/**
 * 只读白名单：只允许明确不会修改远端状态的命令。
 * 白名单之外（含未知命令）一律转人工确认。
 */
const READONLY_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'egrep',
  'fgrep',
  'wc',
  'cut',
  'sort',
  'uniq',
  'tr',
  'df',
  'du',
  'free',
  'uptime',
  'uname',
  'whoami',
  'id',
  'date',
  'hostname',
  'ps',
  'pgrep',
  'ss',
  'netstat',
  'lsof',
  'findmnt',
  'journalctl',
  'systemctl',
  'dmesg',
  'lsblk',
  'blkid',
  'stat',
  'file',
  'readlink',
  'realpath',
  'dirname',
  'basename',
  'nproc',
  'getconf',
  'find',
  'vmstat',
  'iostat',
  'sar',
  'mpstat',
  'docker',
  'kubectl',
  'git'
])

const SYSTEMCTL_READ_VERBS = new Set([
  'status',
  'show',
  'list-units',
  'list-unit-files',
  'list-sockets',
  'list-timers',
  'list-jobs',
  'list-dependencies',
  'is-active',
  'is-enabled',
  'is-failed',
  'cat',
  'help'
])

const DOCKER_READ_VERBS = new Set([
  'ps',
  'images',
  'logs',
  'inspect',
  'stats',
  'version',
  'info',
  'top',
  'port',
  'diff'
])

const KUBECTL_READ_VERBS = new Set([
  'get',
  'describe',
  'logs',
  'top',
  'version',
  'explain',
  'api-resources',
  'api-versions',
  'cluster-info',
  'config',
  'auth'
])

const GIT_READ_VERBS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'remote',
  'rev-parse',
  'show-ref',
  'ls-files',
  'describe',
  'config',
  'blame',
  'shortlog'
])

const HOSTNAME_READ_FLAGS = new Set([
  '-f',
  '--fqdn',
  '-s',
  '--short',
  '-d',
  '--domain',
  '-i',
  '-I',
  '--all-ip-addresses',
  '-A',
  '--all-fqdns'
])

const SENSITIVE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /(^|[\s'"/=:])(\.ssh|id_rsa|id_ed25519|id_ecdsa|id_dsa)([\s'"/]|$)/i,
    reason: '涉及 SSH 密钥'
  },
  {
    pattern: /\.(pem|p12|pfx)\b/i,
    reason: '涉及证书或私钥文件'
  },
  {
    pattern: /(^|[\s'"/])shadow([\s'"]|$)/,
    reason: '涉及 /etc/shadow'
  },
  {
    pattern: /(^|[\s'"/])(\.env|\.npmrc|\.netrc|\.pgpass|\.my\.cnf|\.git-credentials)([\s'"/]|$)/i,
    reason: '涉及凭据配置文件'
  },
  {
    pattern: /(^|[\s'"/])(\.aws\/credentials|\.kube\/config|\.docker\/config\.json)([\s'"]|$)/i,
    reason: '涉及云或集群凭据'
  },
  {
    pattern: /(^|[\s'"/])(\.bash_history|\.zsh_history)([\s'"/]|$)/i,
    reason: '涉及 shell 历史记录'
  },
  {
    pattern: /(^|[\s'"/])environ([\s'"]|$)/,
    reason: '涉及进程环境变量'
  },
  {
    pattern: /\b(credentials|secret|secrets)\.(json|ya?ml|txt)\b/i,
    reason: '涉及凭据文件'
  }
]

const HIGH_RISK_PATTERNS: RegExp[] = [
  /\brm\b/i,
  /\bmkfs(\.\w+)?\b|\bwipefs\b/i,
  /\bdd\b/i,
  /\b(shutdown|reboot|halt|poweroff)\b|\binit\s+0\b/i,
  /\bchmod\s+(-[a-zA-Z]+\s+)*777\b|\bchown\s+-R\b/i,
  /\b(kill|pkill|killall)\b/i,
  /\b(iptables|nft|firewall-cmd)\b/i,
  /\b(fdisk|parted|sfdisk)\b/i,
  /\b(userdel|usermod|useradd|groupdel|groupadd)\b/i,
  /\bpasswd\b|\bchpasswd\b/i,
  /\bcrontab\b/i,
  /\bsed\s+-i\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\b(mount|umount)\b/i,
  /\bsysctl\s+-w\b/i,
  /\b(hostnamectl|timedatectl)\s+set\b/i,
  /\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE)\b/i,
  /\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask|isolate|kill|reboot|poweroff|halt)\b/i,
  /\bdocker\s+(rm|rmi|run|exec|stop|restart|kill|build|push|pull|login|logout)\b/i,
  /\b(curl|wget|scp|rsync)\b/i
]

interface ScanResult {
  segments: string[]
  unsafe: string | null
}

function scanShellSyntax(command: string): ScanResult {
  const segments: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let unsafe: string | null = null

  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote === "'") {
      current += c
      if (c === "'") quote = null
      continue
    }
    if (quote === '"') {
      if (c === '\\') {
        current += c
        if (i + 1 < command.length) current += command[++i]
        continue
      }
      if (c === '"') {
        quote = null
        current += c
        continue
      }
      if (c === '`') unsafe ??= '包含命令替换'
      if (c === '$' && command[i + 1] === '(') unsafe ??= '包含命令替换'
      current += c
      continue
    }
    if (c === '\\') {
      current += c
      if (i + 1 < command.length) current += command[++i]
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      current += c
      continue
    }
    if (c === '`') {
      unsafe ??= '包含命令替换'
      current += c
      continue
    }
    if (c === '$' && command[i + 1] === '(') {
      unsafe ??= '包含命令替换'
      current += c
      continue
    }
    if (c === '>' || c === '<') {
      unsafe ??= '包含重定向'
      current += c
      continue
    }
    if (c === '(' || c === ')') {
      unsafe ??= '包含子 shell 或分组语法'
      current += c
      continue
    }
    if (c === ';') {
      segments.push(current)
      current = ''
      continue
    }
    if (c === '|') {
      if (command[i + 1] === '|') i++
      segments.push(current)
      current = ''
      continue
    }
    if (c === '&') {
      if (command[i + 1] === '&') {
        i++
        segments.push(current)
        current = ''
      } else {
        unsafe ??= '包含后台执行'
        current += c
      }
      continue
    }
    current += c
  }
  if (quote !== null) return { segments, unsafe: '引号不完整' }
  segments.push(current)
  return { segments, unsafe }
}

function tokenize(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else current += c
      continue
    }
    if (quote === '"') {
      if (c === '\\' && i + 1 < segment.length) {
        current += segment[++i]
        continue
      }
      if (c === '"') quote = null
      else current += c
      continue
    }
    if (c === '\\' && i + 1 < segment.length) {
      current += segment[++i]
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      continue
    }
    if (/\s/.test(c)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += c
  }
  if (current) tokens.push(current)
  return tokens
}

function firstNonOption(args: string[]): string | null {
  return args.find((arg) => !arg.startsWith('-')) ?? null
}

function checkReadOnlyArgs(name: string, args: string[]): string | null {
  switch (name) {
    case 'tail':
      if (args.some((a) => /^-[a-zA-Z]*[fF]/.test(a) || a === '--follow')) {
        return 'tail 持续跟踪文件会挂起，需要确认'
      }
      return null
    case 'journalctl':
      if (
        args.some(
          (a) =>
            /^--(vacuum|rotate|flush|sync|relinquish|setup-keys|update-catalog)/.test(a) ||
            a === '-f' ||
            a === '--follow'
        )
      ) {
        return 'journalctl 的清理/轮转/持续跟踪操作需要确认'
      }
      return null
    case 'systemctl': {
      const verb = firstNonOption(args)
      if (verb && !SYSTEMCTL_READ_VERBS.has(verb)) {
        return `systemctl ${verb} 可能变更服务状态，需要确认`
      }
      return null
    }
    case 'docker': {
      const verb = firstNonOption(args)
      if (verb && !DOCKER_READ_VERBS.has(verb)) {
        return `docker ${verb} 不在只读范围，需要确认`
      }
      if (verb === 'logs' && args.some((a) => a === '-f' || a === '--follow')) {
        return 'docker logs 持续跟踪会挂起，需要确认'
      }
      if (verb === 'stats' && !args.includes('--no-stream')) {
        return 'docker stats 持续采样会挂起，需要确认'
      }
      return null
    }
    case 'kubectl': {
      const verb = firstNonOption(args)
      if (verb && !KUBECTL_READ_VERBS.has(verb)) {
        return `kubectl ${verb} 不在只读范围，需要确认`
      }
      if (verb === 'logs' && args.some((a) => a === '-f' || a === '--follow')) {
        return 'kubectl logs 持续跟踪会挂起，需要确认'
      }
      if ((verb === 'get' || verb === 'top') && args.some((a) => a === '-w' || a === '--watch')) {
        return 'kubectl 持续监听会挂起，需要确认'
      }
      if (verb === 'config') {
        const rest = args.slice(args.indexOf('config') + 1)
        const sub = rest.find((a) => !a.startsWith('-'))
        if (!sub || !['view', 'get-contexts', 'current-context'].includes(sub)) {
          return 'kubectl config 的写入操作需要确认'
        }
      }
      if (verb === 'auth') {
        const rest = args.slice(args.indexOf('auth') + 1)
        const sub = rest.find((a) => !a.startsWith('-'))
        if (!sub || !['can-i', 'whoami'].includes(sub)) {
          return 'kubectl auth 的非只读操作需要确认'
        }
      }
      return null
    }
    case 'git': {
      const verb = firstNonOption(args)
      if (verb && !GIT_READ_VERBS.has(verb)) {
        return `git ${verb} 不在只读范围，需要确认`
      }
      if (verb === 'branch') {
        const rest = args.slice(args.indexOf('branch') + 1)
        const listMode = rest.some((a) =>
          ['--list', '-l', '--contains', '--merged', '--no-merged', '--points-at'].includes(a)
        )
        if (!listMode && rest.some((a) => !a.startsWith('-'))) {
          return 'git branch 的创建/变更操作需要确认'
        }
        if (
          rest.some(
            (a) => /^-[dDmMcC]$/.test(a) || a === '--delete' || a === '--move' || a === '--copy'
          )
        ) {
          return 'git branch 的删除/重命名/复制操作需要确认'
        }
      }
      if (
        verb === 'config' &&
        args.some((a) =>
          [
            '--add',
            '--unset',
            '--unset-all',
            '--replace-all',
            '--rename-section',
            '--remove-section',
            '--edit',
            '-e'
          ].includes(a)
        )
      ) {
        return 'git config 的写入操作需要确认'
      }
      if (verb === 'remote') {
        const rest = args.slice(args.indexOf(verb) + 1)
        const readOnly = rest.every((a) => ['-v', '--verbose'].includes(a)) || rest[0] === 'show'
        if (!readOnly) return 'git remote 的变更操作需要确认'
      }
      return null
    }
    case 'find':
      if (
        args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(a))
      ) {
        return 'find 的 -exec/-delete 等操作会修改系统，需要确认'
      }
      return null
    case 'date': {
      if (args.some((a) => a === '-s' || a.startsWith('--set'))) {
        return 'date 设置系统时间需要确认'
      }
      const valueFlags = new Set(['-d', '--date', '-r', '--reference', '-f', '--file'])
      let skipNext = false
      for (const arg of args) {
        if (skipNext) {
          skipNext = false
          continue
        }
        if (valueFlags.has(arg)) {
          skipNext = true
          continue
        }
        if (arg.startsWith('-') || arg.startsWith('+')) continue
        return 'date 设置系统时间需要确认'
      }
      return null
    }
    case 'sort':
      if (args.some((a) => a === '-o' || a.startsWith('--output') || /^-o\S/.test(a))) {
        return 'sort 写文件需要确认'
      }
      if (args.some((a) => a.startsWith('--compress-program'))) {
        return 'sort 调用外部压缩程序需要确认'
      }
      return null
    case 'uniq': {
      const files = args.filter((a) => !a.startsWith('-'))
      if (files.length >= 2) return 'uniq 写输出文件需要确认'
      return null
    }
    case 'hostname':
      if (args.length > 0 && !args.every((a) => HOSTNAME_READ_FLAGS.has(a))) {
        return 'hostname 修改主机名需要确认'
      }
      return null
    case 'dmesg':
      if (args.some((a) => a === '-c' || a === '-C' || a === '--clear' || a === '--read-clear')) {
        return 'dmesg 清理缓冲区需要确认'
      }
      return null
    case 'ss':
      if (args.some((a) => a === '-K' || a === '--kill')) {
        return 'ss -K 会终止连接，需要确认'
      }
      return null
    case 'vmstat':
    case 'iostat':
    case 'mpstat':
    case 'sar': {
      // 只给一个间隔会持续采样，60 秒超时前一直挂起
      const numeric = args.filter((a) => /^\d+(\.\d+)?$/.test(a))
      if (numeric.length === 1) return `${name} 持续采样会挂起，需要确认`
      return null
    }
    default:
      return null
  }
}

function resolveExecutable(token: string): { name: string | null; reason?: string } {
  if (!token.includes('/')) return { name: token }
  const match = /^(?:\/usr)?(?:\/local)?\/s?bin\/([A-Za-z0-9_.-]+)$/.exec(token)
  if (match && READONLY_COMMANDS.has(match[1])) return { name: match[1] }
  return { name: null, reason: '可执行文件路径不在只读白名单内' }
}

function confirmDecision(reason: string, risk: CommandRiskLevel): CommandDecision {
  return { verdict: 'confirm', risk, reason }
}

function riskOf(command: string): CommandRiskLevel {
  return HIGH_RISK_PATTERNS.some((pattern) => pattern.test(command)) ? 'high' : 'medium'
}

/**
 * 判定命令属于自动执行、人工确认还是直接拒绝。
 * 该函数在主进程执行，渲染进程与模型都无法绕过。
 */
export function evaluateCommand(raw: string): CommandDecision {
  const command = raw.trim()
  if (!command) return { verdict: 'reject', risk: 'unknown', reason: '命令为空' }
  if (/[\r\n]/.test(raw)) {
    return { verdict: 'reject', risk: 'unknown', reason: '不支持多行命令' }
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    return {
      verdict: 'reject',
      risk: 'unknown',
      reason: `命令过长（超过 ${MAX_COMMAND_LENGTH} 字符）`
    }
  }

  const sensitive = SENSITIVE_PATTERNS.find((item) => item.pattern.test(command))
  if (sensitive) return confirmDecision(sensitive.reason, 'high')

  const scan = scanShellSyntax(command)
  if (scan.unsafe === '引号不完整') {
    return { verdict: 'reject', risk: 'unknown', reason: '命令引号不完整' }
  }
  if (scan.unsafe) return confirmDecision(scan.unsafe, riskOf(command))

  const segments = scan.segments.map((s) => s.trim()).filter(Boolean)
  if (segments.length === 0) {
    return { verdict: 'reject', risk: 'unknown', reason: '命令为空' }
  }

  for (const segment of segments) {
    const tokens = tokenize(segment)
    if (tokens.length === 0) continue
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
      return confirmDecision('包含环境变量赋值，可能影响后续命令', 'high')
    }
    const resolved = resolveExecutable(tokens[0])
    if (!resolved.name) {
      return confirmDecision(resolved.reason ?? '可执行文件不在白名单内', riskOf(command))
    }
    if (!READONLY_COMMANDS.has(resolved.name)) {
      return confirmDecision(`“${resolved.name}”不在只读白名单内`, riskOf(command))
    }
    const argReason = checkReadOnlyArgs(resolved.name, tokens.slice(1))
    if (argReason) return confirmDecision(argReason, riskOf(command))
  }

  return { verdict: 'auto', risk: 'low', reason: '只读白名单命令' }
}
