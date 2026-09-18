import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ConnectionInput } from '@shared/types'
import { buildConnectConfigFromInput } from '../config'
import { testConnect } from '../connectionManager'
import { startTestSshServer, TestSshServer } from './testSshServer'

let server: TestSshServer

beforeAll(async () => {
  server = await startTestSshServer()
})

afterAll(() => {
  server.close()
})

function makeInput(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  return {
    name: 'test',
    groupId: null,
    host: '127.0.0.1',
    port: server.port,
    username: 'tester',
    authType: 'password',
    remark: '',
    color: '#10b981',
    ...overrides
  }
}

describe('testConnect 集成', () => {
  it('凭据正确时连接成功', async () => {
    const config = await buildConnectConfigFromInput(makeInput({ password: 'test-pass' }), null)
    await expect(testConnect(config)).resolves.toBeUndefined()
  })

  it('密码错误时抛出认证失败', async () => {
    const config = await buildConnectConfigFromInput(makeInput({ password: 'wrong-pass' }), null)
    await expect(testConnect(config)).rejects.toThrow()
  })

  it('主机不可达时抛出网络错误', async () => {
    const config = await buildConnectConfigFromInput(
      makeInput({ host: '127.0.0.1', port: 1, password: 'test-pass' }),
      null
    )
    await expect(testConnect(config)).rejects.toThrow()
  })

  it('密码缺失且无回退凭据时构建配置报错', async () => {
    await expect(buildConnectConfigFromInput(makeInput(), null)).rejects.toThrow('缺少密码')
  })

  it('编辑场景：密码留空时回退到已保存凭据', async () => {
    const config = await buildConnectConfigFromInput(makeInput(), { password: 'test-pass' })
    expect(config.password).toBe('test-pass')
    await expect(testConnect(config)).resolves.toBeUndefined()
  })

  it('表单输入密码优先于已保存凭据', async () => {
    const config = await buildConnectConfigFromInput(makeInput({ password: 'test-pass' }), {
      password: 'old-pass'
    })
    expect(config.password).toBe('test-pass')
  })
})
