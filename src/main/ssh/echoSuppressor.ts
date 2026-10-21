/**
 * 终端初始化染色脚本：单行命令写入远端 shell。
 * 必须是单行：tty 逐行回显输入，多行会被 shell 逐行执行并在行间插入
 * 新提示符（bracketed paste 环境下回显不再是连续块，无法整体抑制）。
 * 行长度不受终端宽度限制——换行是渲染层行为，回显字节流不会被插入 \r\n。
 */
export const SETUP_LINE =
  "export TERM=xterm-256color; export CLICOLOR=1; export LS_COLORS='di=01;34:ln=01;36:so=01;35:pi=33:ex=01;32'; alias ls='ls --color=auto' 2>/dev/null; alias grep='grep --color=auto' 2>/dev/null; if [ -n \"$BASH_VERSION\" ]; then export PS1=\"$(printf '\\033[38;5;45m')\\\\u@\\\\h$(printf '\\033[38;5;111m'):\\\\w$(printf '\\033[38;5;220m')\\\\$ \"; elif [ -n \"$ZSH_VERSION\" ]; then PROMPT='%F{cyan}%n@%m%f:%F{blue}%~%f%F{yellow}%#%f '; fi"

/** 写入远端 shell 的初始化字节流。 */
export function buildSetupPayload(): Buffer {
  return Buffer.from(SETUP_LINE + '\n', 'utf8')
}

const FLUSH_CAP = 16_384

/**
 * 回显抑制器：tty 会把我们写入的初始化命令原样回显回来，
 * 这里在数据到达渲染层之前把这段回显剥掉（保留其后跟着的换行，
 * 视觉效果相当于用户按了一次回车）。
 * 容错策略：只保留「可能是回显开头」的尾巴，其余立即放行；
 * 缓冲超过上限仍未匹配则全部放行（宁可显示也不丢数据）。
 */
export class EchoSuppressor {
  private buf: Buffer[] = []
  private buffered = 0
  private done = false

  constructor(
    private readonly needles: Buffer[],
    private readonly cap = FLUSH_CAP
  ) {}

  push(chunk: Buffer): Buffer | null {
    if (this.done) return chunk
    this.buf.push(chunk)
    this.buffered += chunk.length
    const all = Buffer.concat(this.buf)

    let idx = -1
    let hit: Buffer | null = null
    for (const needle of this.needles) {
      const i = all.indexOf(needle)
      if (i >= 0 && (idx < 0 || i < idx)) {
        idx = i
        hit = needle
      }
    }
    if (hit) {
      this.done = true
      const out = Buffer.concat([all.subarray(0, idx), all.subarray(idx + hit.length)])
      return out.length > 0 ? out : null
    }

    // 未命中：保留可能与回显开头重叠的尾巴，其余放行
    const maxKeep = Math.max(...this.needles.map((n) => n.length)) - 1
    let keep = Math.min(all.length, maxKeep)
    while (keep > 0) {
      const tail = all.subarray(all.length - keep)
      if (this.needles.some((n) => n.length >= keep && tail.equals(n.subarray(0, keep)))) break
      keep--
    }
    const head = all.subarray(0, all.length - keep)
    const rest = all.subarray(all.length - keep)
    this.buf = keep > 0 ? [rest] : []
    this.buffered = keep

    if (this.buffered > this.cap) {
      // 兜底：回显迟迟不来，全部放行
      this.done = true
      return Buffer.concat([head, rest])
    }
    return head.length > 0 ? head : null
  }
}

/** 为初始化脚本创建抑制器：匹配单行回显（不含行尾换行）。 */
export function createSetupEchoSuppressor(): EchoSuppressor {
  return new EchoSuppressor([Buffer.from(SETUP_LINE, 'utf8')])
}

/**
 * 判断输出尾部是否是 shell 提示符（以 "$ "/"# "/"% "/"> " 结尾）。
 * 用于决定何时写入初始化脚本：堡垒机握手/菜单阶段不能写，
 * 否则输入会被菜单吞掉甚至导致会话被拆除。
 */
export function looksLikeShellPrompt(text: string): boolean {
  return /[$#%>] $/.test(text)
}
