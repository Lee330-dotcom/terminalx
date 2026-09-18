import { Socket } from 'net'
import { ProbeResult, ProbeTarget } from '@shared/types'

const PROBE_TIMEOUT_MS = 2000

export function probeLatency(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = new Socket()
    const started = Date.now()
    let finished = false
    const finish = (latency: number | null): void => {
      if (finished) return
      finished = true
      socket.destroy()
      resolve(latency)
    }
    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once('connect', () => finish(Date.now() - started))
    socket.once('error', () => finish(null))
    socket.once('timeout', () => finish(null))
    socket.connect(port, host)
  })
}

/** 顺序探测避免瞬时打满目标端口。 */
export async function probeTargets(targets: ProbeTarget[]): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  for (const t of targets) {
    results.push({ id: t.id, latencyMs: await probeLatency(t.host, t.port) })
  }
  return results
}
