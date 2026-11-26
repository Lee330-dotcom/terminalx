import { readJson, writeJsonAtomic } from './jsonFile'
import { AiChatConversation } from '@shared/types'

/** 保留的对话条数上限：超出后丢弃最旧的对话。 */
const MAX_CONVERSATIONS = 50

/**
 * 助手对话历史：把每轮 AI 对话（含工具调用与执行结果）留痕落盘。
 *
 * 对话内容是用户与模型的问答以及命令输出，不含凭据，
 * 因此明文落盘，便于用户回看排障过程。
 */
export class AiChatStore {
  /** 写操作串行化：对话是"读—改—写"流程，这里用进程内队列把读改写串起来。 */
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn)
    this.writeChain = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<AiChatConversation[]> {
    try {
      const data = await readJson<AiChatConversation[]>(this.file, [])
      if (!Array.isArray(data)) return []
      return data.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
    } catch {
      // 文件损坏：降级为空列表，不影响助手使用
      return []
    }
  }

  private async save(conversations: AiChatConversation[]): Promise<void> {
    await writeJsonAtomic(this.file, conversations)
  }

  private trim(conversations: AiChatConversation[]): AiChatConversation[] {
    if (conversations.length <= MAX_CONVERSATIONS) return conversations
    return [...conversations]
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(-MAX_CONVERSATIONS)
  }

  /** 列出全部对话，按更新时间倒序（最新在前）。 */
  async list(): Promise<AiChatConversation[]> {
    const data = await this.load()
    return [...data].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** 保存（覆盖）一段对话。 */
  async saveConversation(conversation: AiChatConversation): Promise<void> {
    if (!conversation?.id) throw new Error('对话 id 不能为空')
    await this.withLock(async () => {
      const data = await this.load()
      const index = data.findIndex((c) => c.id === conversation.id)
      if (index >= 0) {
        data[index] = conversation
      } else {
        data.push(conversation)
      }
      await this.save(this.trim(data))
    })
  }

  /** 删除一段对话；返回是否确实删除了。 */
  async remove(id: string): Promise<boolean> {
    return this.withLock(async () => {
      const data = await this.load()
      const next = data.filter((c) => c.id !== id)
      if (next.length === data.length) return false
      await this.save(next)
      return true
    })
  }

  /** 清空全部对话。 */
  async clear(): Promise<void> {
    await this.withLock(async () => {
      await this.save([])
    })
  }
}
