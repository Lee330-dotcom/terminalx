import { describe, it, expect } from 'vitest'
import {
  COMMAND_SYSTEM_PROMPT,
  commandSuggestionMessages,
  connectionDiagnosisMessages,
  explainSelectionMessages,
  READ_ONLY_SYSTEM_PROMPT,
  sessionSummaryMessages
} from '../prompts'

function userContent(messages: { role: string; content: string }[]): string {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n')
}

describe('AI 提示词构造', () => {
  it('选段解释包含选中内容与连接名，system 声明只读', () => {
    const messages = explainSelectionMessages('java.lang.OutOfMemoryError', 'helink-pro')
    expect(messages[0].content).toBe(READ_ONLY_SYSTEM_PROMPT)
    expect(messages[0].content).toContain('只读')
    const content = userContent(messages)
    expect(content).toContain('java.lang.OutOfMemoryError')
    expect(content).toContain('helink-pro')
  })

  it('会话摘要包含传入的行', () => {
    const content = userContent(sessionSummaryMessages(['line-a', 'line-b'], 'test'))
    expect(content).toContain('最近 2 行')
    expect(content).toContain('line-a')
    expect(content).toContain('line-b')
  })

  it('命令建议包含指令、上下文行与固定输出模板', () => {
    const messages = commandSuggestionMessages({
      instruction: '查看最近一小时 ERROR 日志',
      lines: ['line-1', 'ERROR something'],
      connectionName: 'helink-pro'
    })
    expect(messages[0].content).toBe(COMMAND_SYSTEM_PROMPT)
    expect(messages[0].content).toContain('最多给出 3 条候选')
    expect(messages[0].content).toContain('单行')
    expect(messages[0].content).toContain('### 1.')
    const content = userContent(messages)
    expect(content).toContain('查看最近一小时 ERROR 日志')
    expect(content).toContain('最近 2 行')
    expect(content).toContain('ERROR something')
    expect(content).toContain('helink-pro')
  })

  it('连接诊断包含元数据且不含任何凭据字段', () => {
    const content = userContent(
      connectionDiagnosisMessages({
        errorMessage: '认证失败',
        connectionName: 'prod-db',
        host: '10.0.0.8',
        port: 22,
        username: 'ops',
        authType: 'privateKey'
      })
    )
    expect(content).toContain('10.0.0.8:22')
    expect(content).toContain('ops')
    expect(content).toContain('私钥认证')
    expect(content).toContain('认证失败')
    expect(content).not.toMatch(/password|passphrase|privateKey/i)
  })
})
