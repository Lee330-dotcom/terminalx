import { AuthType } from '@shared/types'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export const READ_ONLY_SYSTEM_PROMPT = [
  '你是 terminalX 内置的 Linux 运维分析助手，只做只读分析。',
  '规则：',
  '1. 你无法执行任何命令，也不要声称已经执行或验证过任何操作。',
  '2. 不要要求用户直接粘贴执行高风险命令（删除、覆盖、重启、改权限等）；只给检查项和排查方向。',
  '3. 不要重复输出日志中出现的密码、密钥、令牌等敏感值。',
  '4. 用中文回答，结构固定为：结论、可能原因、建议排查步骤。',
  '5. 信息不足时明确指出缺少哪些信息，不要编造。'
].join('\n')

function withConnection(connectionName?: string): string {
  return connectionName ? `连接：${connectionName}\n` : ''
}

export function explainSelectionMessages(
  selection: string,
  connectionName?: string
): ChatMessage[] {
  return [
    { role: 'system', content: READ_ONLY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        withConnection(connectionName) + '用户在终端中选中了以下内容：',
        '```',
        selection,
        '```',
        '请解释这段内容的含义，判断是否代表异常，并给出可能原因与下一步排查建议。'
      ].join('\n')
    }
  ]
}

export function sessionSummaryMessages(lines: string[], connectionName?: string): ChatMessage[] {
  return [
    { role: 'system', content: READ_ONLY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        withConnection(connectionName) +
          `以下是当前终端会话最近 ${lines.length} 行输出（可能包含命令回显与日志）：`,
        '```',
        lines.join('\n'),
        '```',
        '请归纳：1) 时间线关键事件；2) 错误与异常聚类（按影响或出现频率）；3) 建议的下一步排查方向。'
      ].join('\n')
    }
  ]
}

export interface DiagnosisInput {
  errorMessage: string
  connectionName?: string
  host?: string
  port?: number
  username?: string
  authType?: AuthType
}

const AUTH_LABELS: Record<AuthType, string> = {
  password: '密码认证',
  privateKey: '私钥认证'
}

export function connectionDiagnosisMessages(input: DiagnosisInput): ChatMessage[] {
  const target = [input.host, input.port].filter((v) => v != null).join(':')
  const meta = [
    withConnection(input.connectionName).trimEnd(),
    target ? `目标：${target}` : '',
    input.username ? `用户名：${input.username}` : '',
    input.authType ? `认证方式：${AUTH_LABELS[input.authType]}` : ''
  ]
    .filter(Boolean)
    .join('\n')
  return [
    { role: 'system', content: READ_ONLY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        meta,
        `错误信息：${input.errorMessage}`,
        '请判断最可能的失败原因（认证、网络、端口、服务端限制等），并给出按优先级排序的检查清单。'
      ].join('\n')
    }
  ]
}

export const COMMAND_SYSTEM_PROMPT = [
  '你是 terminalX 内置的 Linux 命令助手，负责把用户的自然语言需求转成可核对的命令建议。',
  '规则：',
  '1. 你无法执行任何命令，也不要声称已经执行或验证过任何操作。',
  '2. 最多给出 3 条候选，按推荐顺序排列；每条命令必须是单行，禁止包含换行、heredoc 或需要交互输入的命令。',
  '3. 优先给只读、影响可控的命令；只有用户明确要求时才给写操作或高危操作，并在说明里写清影响范围。',
  '4. 不要重复输出日志中出现的密码、密钥、令牌等敏感值。',
  '5. 信息不足时先指出缺少什么，再给保守的只读命令。',
  '6. 用中文写说明，严格按以下格式输出，每条候选之间空一行：',
  '### 1. <一句话说明用途>',
  '风险：低',
  '```bash',
  '<单行命令>',
  '```',
  '风险只能是 低、中、高 之一；命令必须放在 bash 代码块内。'
].join('\n')

export interface AgentPromptInput {
  connectionName?: string
  host?: string
  port?: number
  username?: string
  maxSteps: number
}

export function agentSystemPrompt(input: AgentPromptInput): string {
  const target = [input.host, input.port].filter((v) => v != null).join(':')
  const meta = [
    input.connectionName ? `连接：${input.connectionName}` : '',
    target ? `目标：${target}` : '',
    input.username ? `用户名：${input.username}` : ''
  ]
    .filter(Boolean)
    .join('\n')
  return [
    '你是 terminalX 内置的全自动 Linux 运维助手。',
    meta,
    '你可以调用 execute_command 工具在用户当前连接上执行命令。该工具使用独立的非交互 exec 通道，不会影响用户的终端窗口。',
    '规则：',
    '1. 需要事实依据时先调用工具，不要编造执行结果；没有工具结果就不要声称命令已经执行或验证。',
    `2. 每次任务最多 ${input.maxSteps} 次工具调用；接近上限时优先给出阶段性结论。`,
    '3. 每次只提交一条单行命令，禁止多行、heredoc、反引号与交互式命令（如 vi、top、passwd）。',
    '4. 优先使用只读命令收集信息；write/变更类命令会先让用户确认，说明目的与影响后再提交。',
    '5. 每次执行都是新的 shell，不保留上一次的目录与环境变量；需要连续操作时用 && 合并成一条，或使用绝对路径。',
    '6. 不要执行需要输入密码、密钥或令牌的命令，也不要把日志中的敏感值复述给用户。',
    '7. 用户拒绝某条命令后不要重复提交，改用只读方式或直接说明风险。',
    '8. 用中文回答，按「结论、依据、下一步」组织；信息不足时明确指出缺少什么。'
  ]
    .filter(Boolean)
    .join('\n')
}

export interface CommandSuggestionInput {
  instruction: string
  lines: string[]
  connectionName?: string
}

export function commandSuggestionMessages(input: CommandSuggestionInput): ChatMessage[] {
  return [
    { role: 'system', content: COMMAND_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        withConnection(input.connectionName) +
          `以下是当前终端会话最近 ${input.lines.length} 行输出（可能包含命令回显与日志）：`,
        '```',
        input.lines.join('\n'),
        '```',
        `用户需求：${input.instruction}`,
        '请按系统消息中的格式给出命令建议。'
      ].join('\n')
    }
  ]
}
