import { defineConfig } from 'vitest/config'

// 手动验证脚本（依赖本地临时 sshd，不进入常规 test:e2e）
// 前置：/usr/sbin/sshd -f /tmp/ssh-e2e/sshd_config -E /tmp/ssh-e2e/sshd.log
// 运行：npx vitest run --config vitest.manual.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/e2e/**/*.manual.ts'],
    testTimeout: 120000,
    hookTimeout: 120000
  }
})
