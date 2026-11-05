// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../markdown'

describe('renderMarkdown', () => {
  it('渲染标题、列表、强调与行内代码', () => {
    const html = renderMarkdown('## 结论\n\n- **正常**\n- 执行 `uptime`')
    expect(html).toContain('<h2')
    expect(html).toContain('<li>')
    expect(html).toContain('<strong>正常</strong>')
    expect(html).toContain('<code>uptime</code>')
  })

  it('过滤脚本、事件属性与危险链接', () => {
    const html = renderMarkdown(
      '[x](javascript:alert(1)) <script>alert(1)</script> <img src=x onerror=alert(1)>'
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('onerror')
  })

  it('外链在新窗口打开', () => {
    const html = renderMarkdown('[文档](https://example.com/doc)')
    expect(html).toContain('href="https://example.com/doc"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
