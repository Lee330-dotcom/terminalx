import { ElMessage } from 'element-plus'
import { Snippet } from '@shared/types'
import { applySnippetPlaceholders, parseSnippetPlaceholders } from '@shared/snippets'
import { useSnippetRunStore } from '../stores/snippetRun'
import { t } from '../i18n'

/**
 * 把命令文本写入终端输入区。
 *
 * 默认不追加回车：命令只进入输入行，由用户自己按 Enter 执行，
 * 避免"点一下就把命令跑了"这种不可复核的行为。
 * 片段显式开启「执行后自动回车」时才补 `\r`。
 */
function sendToSession(sessionId: string, snippet: Snippet, command: string): void {
  const text = snippet.autoEnter ? `${command}\r` : command
  window.api.sendInput(sessionId, new TextEncoder().encode(text))
}

/**
 * 统一下发路径：命令面板、终端右键菜单、管理界面都走这里。
 *
 * - 没有已连接会话：不下发，提示用户
 * - 含占位符：弹窗填参并展示替换后的完整命令，用户确认后才下发
 * - 不含占位符：直接写入输入区
 *
 * @returns 用户是否确认执行
 */
export async function executeSnippet(snippet: Snippet, sessionId: string): Promise<boolean> {
  if (!sessionId) {
    ElMessage.warning(t('snippet.noSession'))
    return false
  }
  const placeholders = parseSnippetPlaceholders(snippet.command)
  if (placeholders.length === 0) {
    sendToSession(sessionId, snippet, snippet.command)
    return true
  }
  const runStore = useSnippetRunStore()
  const result = await runStore.request(snippet, sessionId)
  if (!result.ok) return false
  const command = applySnippetPlaceholders(snippet.command, result.values)
  if (!command.trim()) {
    ElMessage.warning(t('snippet.emptyCommand'))
    return false
  }
  sendToSession(sessionId, snippet, command)
  return true
}
