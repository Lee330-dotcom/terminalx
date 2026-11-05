import { describe, expect, it } from 'vitest'
import {
  compareModels,
  extractReportedModel,
  modelFamily,
  normalizeModelId,
  pickSimilarModels,
  summarizeDiagnosis
} from '../modelDiagnostics'

describe('normalizeModelId', () => {
  it('去掉厂商前缀并转小写', () => {
    expect(normalizeModelId('OpenAI/GPT-4o-mini')).toBe('gpt-4o-mini')
    expect(normalizeModelId('anthropic/claude-3-5-sonnet')).toBe('claude-3-5-sonnet')
  })

  it('去掉日期后缀与 latest 标记', () => {
    expect(normalizeModelId('gpt-4o-mini-2024-07-18')).toBe('gpt-4o-mini')
    expect(normalizeModelId('deepseek-chat-latest')).toBe('deepseek-chat')
  })

  it('处理 ollama 风格 tag', () => {
    expect(normalizeModelId('qwen2.5:7b')).toBe('qwen2.5')
    expect(normalizeModelId('claude-3-5-sonnet@20240620')).toBe('claude-3-5-sonnet')
  })

  it('保留非厂商前缀的路径', () => {
    expect(normalizeModelId('accounts/fireworks/models/llama-v3')).toBe(
      'accounts/fireworks/models/llama-v3'
    )
  })
})

describe('modelFamily', () => {
  it('识别常见模型族', () => {
    expect(modelFamily('gpt-4o-mini')).toBe('gpt')
    expect(modelFamily('claude-3-5-sonnet')).toBe('claude')
    expect(modelFamily('deepseek-chat')).toBe('deepseek')
    expect(modelFamily('qwen2.5-72b-instruct')).toBe('qwen')
    expect(modelFamily('glm-4-plus')).toBe('glm')
    expect(modelFamily('kimi-k2')).toBe('kimi')
    expect(modelFamily('o3-mini')).toBe('o')
  })

  it('无法识别时返回空串', () => {
    expect(modelFamily('internal-gateway-v2')).toBe('')
  })
})

describe('compareModels', () => {
  it('完全相同或仅日期不同时判定一致', () => {
    expect(compareModels('gpt-4o-mini', 'gpt-4o-mini').relation).toBe('same')
    expect(compareModels('gpt-4o-mini', 'gpt-4o-mini-2024-07-18').relation).toBe('same')
    expect(compareModels('openai/gpt-4o', 'GPT-4o').relation).toBe('same')
  })

  it('同族不同档位判定为相关', () => {
    expect(compareModels('gpt-4o-mini', 'gpt-4o').relation).toBe('related')
    expect(compareModels('deepseek-chat', 'deepseek-reasoner').relation).toBe('related')
  })

  it('不同族判定为不一致', () => {
    expect(compareModels('gpt-4o-mini', 'claude-3-5-sonnet').relation).toBe('different')
    expect(compareModels('deepseek-chat', 'qwen-max').relation).toBe('different')
  })

  it('空值判定为未知', () => {
    expect(compareModels('', 'gpt-4o').relation).toBe('unknown')
  })
})

describe('extractReportedModel', () => {
  it('从中文自述中提取模型名', () => {
    expect(extractReportedModel('我是 OpenAI 开发的 GPT-4o mini。')).toMatch(/gpt-4o/i)
  })

  it('从英文自述中提取模型名', () => {
    expect(extractReportedModel('I am Claude 3.5 Sonnet, made by Anthropic.')).toMatch(/claude/i)
  })

  it('模型拒答或不确定时返回 undefined', () => {
    expect(extractReportedModel('unknown')).toBeUndefined()
    expect(extractReportedModel('I cannot determine that.')).toBeUndefined()
  })
})

describe('summarizeDiagnosis', () => {
  it('回显与自述都一致时判定 match 且置信度高', () => {
    const s = summarizeDiagnosis({
      configured: 'gpt-4o-mini',
      served: 'gpt-4o-mini-2024-07-18',
      reported: 'GPT-4o mini',
      catalogMatch: true
    })
    expect(s.verdict).toBe('match')
    expect(s.confidence).toBe('high')
  })

  it('回显一致但自述换成别的族时降级为 partial', () => {
    const s = summarizeDiagnosis({
      configured: 'gpt-4o-mini',
      served: 'gpt-4o-mini',
      reported: 'Claude 3.5 Sonnet'
    })
    expect(s.verdict).toBe('partial')
    expect(s.confidence).not.toBe('high')
  })

  it('回显是别的模型时判定 mismatch', () => {
    const s = summarizeDiagnosis({
      configured: 'gpt-4o-mini',
      served: 'qwen-max',
      reported: 'Qwen Max'
    })
    expect(s.verdict).toBe('mismatch')
  })

  it('只有目录信号且模型缺失时不致于判成一致', () => {
    const s = summarizeDiagnosis({ configured: 'gpt-4o-mini', catalogMatch: false })
    expect(s.verdict).toBe('unknown')
  })

  it('完全无信号时判定 unknown、置信度低', () => {
    const s = summarizeDiagnosis({ configured: 'gpt-4o-mini' })
    expect(s.verdict).toBe('unknown')
    expect(s.confidence).toBe('low')
  })
})

describe('pickSimilarModels', () => {
  it('挑出同族模型并从结果中排除自身', () => {
    const catalog = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'claude-3', 'deepseek-chat']
    expect(pickSimilarModels('gpt-4o-mini', catalog)).toEqual(['gpt-4o', 'gpt-4.1'])
  })

  it('无同族模型时返回空数组', () => {
    expect(pickSimilarModels('internal-gw', ['gpt-4o'])).toEqual([])
  })
})
