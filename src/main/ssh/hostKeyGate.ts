import { randomUUID } from 'crypto'
import { HostKeyStore } from '../store/hostKeyStore'
import { fingerprintOfKeyBlob, hostKeyId, keyTypeOfKeyBlob } from './hostKeyUtils'

export type HostKeyStatus = 'new' | 'changed'

export interface HostKeyPromptRequest {
  requestId: string
  host: string
  port: number
  /** 本次握手拿到的指纹 */
  fingerprint: string
  /** 密钥类型，如 ssh-ed25519 */
  keyType: string
  /** 指纹库中已记录的指纹（status 为 changed 时有值） */
  storedFingerprint?: string
  status: HostKeyStatus
}

/** 指纹确认请求的下发方式：把请求送到渲染层，等待用户应答。 */
export type HostKeyPromptEmitter = (request: HostKeyPromptRequest) => void

interface PendingConfirm {
  requestId: string
  promise: Promise<boolean>
  resolve: (accept: boolean) => void
  timer: NodeJS.Timeout
}

const DEFAULT_TIMEOUT_MS = 120_000

/**
 * 主机指纹校验闸门。
 *
 * 判定逻辑：
 * - 指纹库中无记录 → new：向用户展示指纹，确认后写入指纹库
 * - 指纹库中有记录且一致 → match：静默放行，只更新最近确认时间
 * - 指纹库中有记录但不一致 → changed：强告警，用户显式放行后覆盖记录
 *
 * 同一主机的并发握手共享同一次确认（只打扰用户一次）。
 */
export class HostKeyGate {
  private readonly pending = new Map<string, PendingConfirm>()
  private readonly timeoutMs: number

  constructor(
    private readonly store: HostKeyStore,
    private readonly emit: HostKeyPromptEmitter,
    opts: { timeoutMs?: number } = {}
  ) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * 校验一次握手拿到的公钥；不通过时抛出带具体原因的错误。
   * 调用方（如 ssh2 的 hostVerifier）据此决定放行或中断握手。
   */
  async verify(host: string, port: number, keyBlob: Buffer): Promise<void> {
    const started = Date.now()
    const fingerprint = fingerprintOfKeyBlob(keyBlob)
    const keyType = keyTypeOfKeyBlob(keyBlob)
    const stored = await this.store.get(host, port)

    if (stored && stored.fingerprint === fingerprint) {
      await this.store.touch(host, port)
      console.log(
        `[timing] 指纹校验 ${host}:${port} 命中已有指纹，用时 ${Date.now() - started}ms`
      )
      return
    }

    const id = hostKeyId(host, port)
    let pending = this.pending.get(id)
    if (!pending) {
      pending = this.createPending(id, {
        requestId: randomUUID(),
        host,
        port,
        fingerprint,
        keyType,
        storedFingerprint: stored?.fingerprint,
        status: stored ? 'changed' : 'new'
      })
      this.pending.set(id, pending)
    }

    const accepted = await pending.promise
    console.log(
      `[timing] 指纹校验 ${host}:${port} ${stored ? '指纹变更' : '首次信任'}，` +
        `等待用户 ${Date.now() - started}ms`
    )
    if (!accepted) {
      throw new Error(
        stored
          ? `主机指纹与已记录的不一致，已拒绝连接：${host}:${port}`
          : `用户拒绝了主机指纹，未建立连接：${host}:${port}`
      )
    }
    await this.store.trust(host, port, fingerprint, keyType)
  }

  private createPending(
    id: string,
    request: HostKeyPromptRequest
  ): PendingConfirm {
    let resolveFn: (accept: boolean) => void = () => {}
    const promise = new Promise<boolean>((resolve) => {
      resolveFn = resolve
    })
    const pending: PendingConfirm = {
      requestId: request.requestId,
      promise,
      resolve: resolveFn,
      timer: setTimeout(() => {
        this.settle(id, false)
      }, this.timeoutMs)
    }
    this.emit(request)
    return pending
  }

  /** 用户应答一次指纹确认。 */
  respond(requestId: string, accept: boolean): void {
    for (const [id, pending] of this.pending) {
      if (pending.requestId === requestId) {
        this.settle(id, accept)
        return
      }
    }
  }

  private settle(id: string, accept: boolean): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    pending.resolve(accept)
  }

  /** 当前是否有待确认请求（供测试与诊断）。 */
  get pendingCount(): number {
    return this.pending.size
  }
}
