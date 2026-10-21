import { describe, expect, it } from 'vitest'
import {
  buildSetupPayload,
  createSetupEchoSuppressor,
  EchoSuppressor,
  looksLikeShellPrompt,
  SETUP_LINE
} from '../echoSuppressor'

const ECHO_CRLF = Buffer.from(SETUP_LINE + '\r\n', 'utf8')

function collect(suppressor: EchoSuppressor, chunks: Buffer[]): Buffer {
  const out: Buffer[] = []
  for (const c of chunks) {
    const r = suppressor.push(c)
    if (r) out.push(r)
  }
  return Buffer.concat(out)
}

describe('EchoSuppressor', () => {
  it('strips the echoed setup line, keeping banner, newline and later output', () => {
    const banner = Buffer.from('Last login: Tue Oct 20\r\n[haieradmin@p01 ~]$ ', 'utf8')
    const rest = Buffer.from('\x1b[?2004l\r\x1b[?2004h[colored]$ ', 'utf8')
    const suppressor = createSetupEchoSuppressor()
    const out = collect(suppressor, [Buffer.concat([banner, ECHO_CRLF, rest])])
    expect(out.equals(Buffer.concat([banner, Buffer.from('\r\n'), rest]))).toBe(true)
  })

  it('handles the echo split across chunks', () => {
    const banner = Buffer.from('banner$ ', 'utf8')
    const rest = Buffer.from('\r\nnext$ ', 'utf8')
    const suppressor = createSetupEchoSuppressor()
    const full = Buffer.concat([banner, ECHO_CRLF, rest])
    const chunks: Buffer[] = []
    for (let i = 0; i < full.length; i += 37) chunks.push(full.subarray(i, i + 37))
    const out = collect(suppressor, chunks)
    expect(out.equals(Buffer.concat([banner, Buffer.from('\r\n'), rest]))).toBe(true)
  })

  it('passes unrelated output through immediately', () => {
    const suppressor = createSetupEchoSuppressor()
    const hello = Buffer.from('hello world\r\n', 'utf8')
    const out = suppressor.push(hello)
    expect(out?.equals(hello)).toBe(true)
  })

  it('fails open when no echo ever arrives', () => {
    const suppressor = createSetupEchoSuppressor()
    const noise = Buffer.alloc(20_000, 0x61)
    const out = collect(suppressor, [noise])
    expect(out.equals(noise)).toBe(true)
  })

  it('payload is the setup line plus LF', () => {
    expect(buildSetupPayload().equals(Buffer.from(SETUP_LINE + '\n', 'utf8'))).toBe(true)
  })
})

describe('looksLikeShellPrompt', () => {
  it('matches common shell prompts with trailing space', () => {
    expect(looksLikeShellPrompt('[haieradmin@p-hl-app01 ~]$ ')).toBe(true)
    expect(looksLikeShellPrompt('root@host:/# ')).toBe(true)
    expect(looksLikeShellPrompt('macbook:~ user% ')).toBe(true)
    expect(looksLikeShellPrompt('\x1b[38;5;45mhaieradmin@p01\x1b[0m:~$ ')).toBe(true)
  })

  it('does not match bastion banners or menu text', () => {
    expect(looksLikeShellPrompt('Welcome to Elastic Cloud Service\r\n')).toBe(false)
    expect(looksLikeShellPrompt('Connecting to haieradmin@host ...')).toBe(false)
    expect(looksLikeShellPrompt('请输入序号：')).toBe(false)
    expect(looksLikeShellPrompt('')).toBe(false)
  })
})
