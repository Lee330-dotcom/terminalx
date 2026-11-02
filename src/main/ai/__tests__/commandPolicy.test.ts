import { describe, it, expect } from 'vitest'
import { evaluateCommand, MAX_COMMAND_LENGTH } from '../commandPolicy'

function verdict(command: string): string {
  return evaluateCommand(command).verdict
}

describe('commandPolicy 只读白名单', () => {
  it('常见只读命令与简单组合自动执行', () => {
    for (const command of [
      'ls -la',
      'cat /etc/hosts',
      'df -h',
      'ps aux | grep nginx',
      'ls && df -h',
      'ls || df -h',
      'ls; df -h',
      'journalctl -u nginx --no-pager -n 100',
      'systemctl status nginx',
      'systemctl cat nginx',
      'docker ps --format "{{.Names}}"',
      'kubectl get pods -A',
      'git log --oneline -5',
      'git remote -v',
      'git branch --list "feature/*"',
      'git branch -a',
      'kubectl config view',
      'kubectl auth can-i get pods',
      'hostname -f',
      'find /var/log -name "*.log" -mtime -1',
      'date +%F',
      'date -d yesterday +%s',
      'sort -k2 /etc/hosts',
      'uniq -c /tmp/list.txt',
      'vmstat 1 5',
      'docker stats --no-stream',
      '/usr/bin/cat /etc/hosts',
      '/bin/ls /tmp'
    ]) {
      expect(evaluateCommand(command).verdict, command).toBe('auto')
    }
  })

  it('单引号内的命令替换不触发危险构造', () => {
    expect(verdict("ls '$(pwd)'")).toBe('auto')
  })
})

describe('commandPolicy 需要确认的构造', () => {
  it('写操作与未知命令转为确认', () => {
    for (const command of [
      'rm -rf /tmp/x',
      'systemctl restart nginx',
      'docker restart app',
      'git branch -D old',
      'git branch feature-x',
      'git config --add foo.bar baz',
      'kubectl config use-context prod',
      'curl https://example.com',
      'sudo ls',
      '/opt/bin/ls /tmp',
      'VAR=1 ls',
      'tail -f /var/log/app.log',
      'docker logs -f app',
      'docker stats',
      'journalctl -f',
      'find /tmp -name "*.log" -delete',
      'hostname newname',
      'date 01010101',
      'sort -o /tmp/sorted /etc/hosts',
      'uniq /tmp/in.txt /tmp/out.txt',
      'vmstat 1',
      'dmesg -c',
      'ss -K dst 10.0.0.1'
    ]) {
      expect(evaluateCommand(command).verdict, command).toBe('confirm')
    }
  })

  it('重定向、命令替换、后台等危险构造需要确认', () => {
    for (const command of [
      'ls > /tmp/out',
      'ls "$(pwd)"',
      'ls `pwd`',
      'ls &',
      'cat file | xargs rm',
      'echo hi; rm -rf /tmp/x'
    ]) {
      expect(evaluateCommand(command).verdict, command).toBe('confirm')
    }
  })

  it('敏感路径一律高风险管理', () => {
    for (const command of [
      'cat ~/.ssh/id_rsa',
      'cat /etc/shadow',
      'grep -r token ~/.aws/credentials',
      'cat .env',
      'cat /proc/1/environ'
    ]) {
      const decision = evaluateCommand(command)
      expect(decision.verdict, command).toBe('confirm')
      expect(decision.risk, command).toBe('high')
    }
  })

  it('高危写操作标记 high', () => {
    expect(evaluateCommand('rm -rf /').risk).toBe('high')
    expect(evaluateCommand('systemctl restart nginx').risk).toBe('high')
    expect(evaluateCommand('curl https://example.com').risk).toBe('high')
  })
})

describe('commandPolicy 直接拒绝', () => {
  it('多行、空命令、超长命令与不完整引号直接拒绝', () => {
    expect(verdict('')).toBe('reject')
    expect(verdict('   ')).toBe('reject')
    expect(verdict('ls\nls')).toBe('reject')
    expect(verdict('ls\r\ndf -h')).toBe('reject')
    expect(verdict('cat "unclosed')).toBe('reject')
    expect(verdict(`ls ${'a'.repeat(MAX_COMMAND_LENGTH)}`)).toBe('reject')
  })

  it('拒绝时给出原因', () => {
    expect(evaluateCommand('ls\nls').reason).toContain('多行')
    expect(evaluateCommand('cat "unclosed').reason).toContain('引号')
  })
})
