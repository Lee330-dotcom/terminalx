import { describe, expect, it } from 'vitest'
import {
  buildPreview,
  parseBastionCsv,
  parseTemplateCsv,
  toConnectionInputs
} from '../importService'

const BASTION_SAMPLE = [
  'haieradmin@10.250.4.52,10.132.0.70,SSH,22,25029018/10.250.4.52/haieradmin',
  'haieradmin@10.250.4.36,10.132.0.70,SSH,22,25029018/10.250.4.36/haieradmin',
  '',
  'haieradmin@10.250.9.170,10.132.0.70,SSH,22,25029018/10.250.9.170/haieradmin'
].join('\n')

describe('堡垒机透传 CSV 解析', () => {
  it('按列序映射：第 2 列地址、第 4 列端口、第 5 列整串用户名', () => {
    const { rows, invalid } = parseBastionCsv(BASTION_SAMPLE)
    expect(invalid).toBe(0)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      name: 'haieradmin@10.250.4.52',
      host: '10.132.0.70',
      port: 22,
      username: '25029018/10.250.4.52/haieradmin',
      remark: '透传目标 10.250.4.52'
    })
  })

  it('空行跳过，列数不足的行计入 invalid', () => {
    const text = 'a,10.132.0.70,SSH,22,x/y/z\nbroken,row\n\n'
    const { rows, invalid } = parseBastionCsv(text)
    expect(rows).toHaveLength(1)
    expect(invalid).toBe(1)
  })

  it('关键字段缺失的行不导入', () => {
    const { rows, invalid } = parseBastionCsv('name,,SSH,22,acct')
    expect(rows).toHaveLength(0)
    expect(invalid).toBe(1)
  })

  it('非法端口回落到 22', () => {
    const { rows } = parseBastionCsv('n,10.0.0.1,SSH,abc,1/2/3')
    expect(rows[0].port).toBe(22)
  })

  it('带引号且含逗号的字段不会被拆列', () => {
    const { rows } = parseBastionCsv('"a,b",10.0.0.1,SSH,22,1/2/3')
    expect(rows[0].name).toBe('a,b')
  })
})

describe('模板 CSV 解析', () => {
  it('表头驱动的列序，缺 remark 列也可解析', () => {
    const text = 'username,host,name,port\nroot,10.0.0.9,平煤-1,2222'
    const { rows, invalid } = parseTemplateCsv(text)
    expect(invalid).toBe(0)
    expect(rows[0]).toEqual({
      name: '平煤-1',
      host: '10.0.0.9',
      port: 2222,
      username: 'root',
      remark: ''
    })
  })

  it('缺必需列时抛错', () => {
    expect(() => parseTemplateCsv('name,host\na,b')).toThrow(/必需列/)
  })

  it('空字段行计入 invalid', () => {
    const { rows, invalid } = parseTemplateCsv('name,host,port,username,remark\nA,10.0.0.1,22,,备注')
    expect(rows).toHaveLength(0)
    expect(invalid).toBe(1)
  })
})

describe('导入预览与去重', () => {
  it('已有相同 username 的堡垒机连接被跳过', () => {
    const preview = buildPreview('bastion', BASTION_SAMPLE, [
      { host: '10.132.0.70', port: 22, username: '25029018/10.250.4.36/haieradmin' }
    ])
    expect(preview.ok).toBe(true)
    expect(preview.total).toBe(3)
    expect(preview.duplicates).toBe(1)
    expect(preview.rows).toHaveLength(2)
    expect(preview.samples).toEqual([
      'haieradmin@10.250.4.52',
      'haieradmin@10.250.9.170'
    ])
  })

  it('文件内部重复的 username 只导入一次', () => {
    const text = `${BASTION_SAMPLE}\nhaieradmin@10.250.4.52,10.132.0.70,SSH,22,25029018/10.250.4.52/haieradmin`
    const preview = buildPreview('bastion', text, [])
    expect(preview.rows).toHaveLength(3)
    expect(preview.duplicates).toBe(1)
  })

  it('模板按 host+port+username 去重', () => {
    const preview = buildPreview('template', 'name,host,port,username\nA,10.0.0.1,22,root', [
      { host: '10.0.0.1', port: 22, username: 'root' }
    ])
    expect(preview.rows).toHaveLength(0)
    expect(preview.duplicates).toBe(1)
  })

  it('表头错误时返回 ok=false 与错误信息，不抛异常', () => {
    const preview = buildPreview('template', 'foo,bar\n1,2', [])
    expect(preview.ok).toBe(false)
    expect(preview.error).toContain('必需列')
    expect(preview.rows).toHaveLength(0)
  })
})

describe('导入输入构造', () => {
  const preview = buildPreview('bastion', BASTION_SAMPLE, [])

  it('统一密码写入每条连接', () => {
    const inputs = toConnectionInputs(preview, 'group-1', 'Qingdao3303')
    expect(inputs).toHaveLength(3)
    expect(inputs[0]).toMatchObject({
      groupId: 'group-1',
      authType: 'password',
      password: 'Qingdao3303'
    })
  })

  it('未填密码时不带 password 字段，凭据留待编辑时补', () => {
    const inputs = toConnectionInputs(preview, null, '')
    expect(inputs[0].password).toBeUndefined()
    expect(inputs[0].groupId).toBeNull()
  })
})
