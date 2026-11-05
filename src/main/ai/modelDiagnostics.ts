import { AiDiagnoseConfidence, AiDiagnoseVerdict } from '@shared/types'

/**
 * 模型诊断的纯逻辑层：模型名归一化、模型族识别、自述提取与一致性打分。
 * 不发请求，便于单测；实际探针由 AiService 发起。
 */

/** 常见厂商前缀，`openai/gpt-4o` 这类写法归一化时直接去掉 */
const PROVIDER_PREFIXES = new Set([
  'openai',
  'anthropic',
  'google',
  'googleapis',
  'deepseek',
  'qwen',
  'aliyun',
  'dashscope',
  'zhipu',
  'zhipuai',
  'moonshot',
  'moonshotai',
  'baidu',
  'bytedance',
  'volcengine',
  'doubao',
  'tencent',
  'hunyuan',
  'minimax',
  'xai',
  'meta',
  'mistralai',
  'mistral',
  'groq',
  'openrouter',
  'siliconflow',
  'ollama',
  'azure',
  'modelscope'
])

/** 模型族关键词：用于判断「配置的模型」与「实际回答的模型」是否同一家族 */
const FAMILY_PATTERNS: { family: string; re: RegExp }[] = [
  { family: 'gpt', re: /\bgpt(?![a-z])/i },
  { family: 'chatgpt', re: /\bchatgpt\b/i },
  { family: 'o', re: /\bo[1-9](?:[-\s]?(?:mini|preview|pro))?\b/i },
  { family: 'claude', re: /\bclaude\b/i },
  { family: 'gemini', re: /\bgemini\b/i },
  { family: 'gemma', re: /\bgemma\b/i },
  { family: 'deepseek', re: /\bdeepseek\b/i },
  { family: 'qwen', re: /\b(?:qwen|tongyi|通义)/i },
  { family: 'glm', re: /\b(?:glm|chatglm|智谱)\b/i },
  { family: 'kimi', re: /\b(?:kimi|moonshot)\b/i },
  { family: 'llama', re: /\b(?:llama|meta\s+llama)\b/i },
  { family: 'mistral', re: /\b(?:mistral|mixtral|codestral)\b/i },
  { family: 'grok', re: /\bgrok\b/i },
  { family: 'doubao', re: /\b(?:doubao|豆包)\b/i },
  { family: 'seed', re: /\bseed(?:-\d|\b)/i },
  { family: 'ernie', re: /\b(?:ernie|文心)\b/i },
  { family: 'hunyuan', re: /\b(?:hunyuan|混元)\b/i },
  { family: 'minimax', re: /\bminimax\b/i },
  { family: 'mimo', re: /\bmimo\b/i },
  { family: 'step', re: /\bstep[-\s]?\d/i },
  { family: 'phi', re: /\bphi[-\s]?\d/i },
  { family: 'command', re: /\bcommand[-\s]?r\b/i },
  { family: 'yi', re: /\byi[-\s]?(?:large|medium|light|\d)/i }
]

/** 档位/形态限定词，同族但档位不同时判为「相关」而非「一致」 */
const QUALIFIERS = [
  'nano',
  'mini',
  'lite',
  'small',
  'flash',
  'air',
  'turbo',
  'pro',
  'max',
  'ultra',
  'plus',
  'reasoner',
  'reasoning',
  'thinking',
  'chat',
  'instruct',
  'base',
  'preview',
  'distill',
  'coder',
  'vl',
  'omni',
  'audio',
  'realtime',
  'high',
  'medium',
  'low'
]

/** 诊断探针：两条问法交叉验证自述，避免单次幻觉被当成结论 */
export const DIAGNOSE_PROBES: { id: string; prompt: string }[] = [
  {
    id: 'identity-zh',
    prompt:
      '请如实回答：你当前是哪一个模型？只用一行输出「厂商/模型名/版本号」，不要解释，不要添加任何其他内容。如果不确定，就输出 unknown。'
  },
  {
    id: 'identity-en',
    prompt:
      'Answer honestly: which exact model are you right now? Reply with a single line in the form provider/model/version. No explanation. If you are not sure, reply unknown.'
  }
]

/** 归一化模型名：去厂商前缀、ollama tag、日期后缀、latest 等 */
export function normalizeModelId(id: string): string {
  let s = id.trim().toLowerCase()
  if (!s) return ''
  const prefixed = /^([a-z0-9_-]+)\//.exec(s)
  if (prefixed && PROVIDER_PREFIXES.has(prefixed[1])) s = s.slice(prefixed[0].length)
  s = s.replace(/@[a-z0-9._-]+$/, '') // qwen2.5:7b@latest 之类的标签
  const colon = s.indexOf(':')
  if (colon > 0) s = s.slice(0, colon) // qwen2.5:7b → qwen2.5
  s = s.replace(/[-_.]20\d{2}[-_.]?\d{2}[-_.]?\d{2}$/, '') // 2024-07-18 / 20240718
  s = s.replace(/[-_.](?:latest|stable)$/, '')
  return s
    .replace(/\s+/g, '-')
    .replace(/[-_.]{2,}/g, '-')
    .replace(/[-_.]+$/, '')
}

/** 识别模型族；识别不出返回空串 */
export function modelFamily(id: string): string {
  const normalized = normalizeModelId(id)
  if (!normalized) return ''
  for (const { family, re } of FAMILY_PATTERNS) {
    if (re.test(normalized)) return family
  }
  return ''
}

/** 提取模型名里的数字版本，如 gpt-4o → [4]，qwen2.5-72b → [2, 5, 72] */
export function versionTokens(id: string): number[] {
  return (normalizeModelId(id).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
}

/** 提取模型名里的档位限定词，如 gpt-4o-mini → ['mini'] */
export function qualifierTokens(id: string): string[] {
  const normalized = normalizeModelId(id)
  return QUALIFIERS.filter((q) => new RegExp(`(^|[-_.])${q}([-_.]|$)`, 'i').test(normalized))
}

export type ModelRelation = 'same' | 'related' | 'different' | 'unknown'

export interface RelationDetail {
  relation: ModelRelation
  /** 判定依据：exact / family / version / qualifier / empty */
  reason: string
}

/** 比较两个模型名是否指向同一个模型 */
export function compareModels(configured: string, candidate: string): RelationDetail {
  const a = normalizeModelId(configured)
  const b = normalizeModelId(candidate)
  if (!a || !b) return { relation: 'unknown', reason: 'empty' }
  if (a === b) return { relation: 'same', reason: 'exact' }

  const familyA = modelFamily(a)
  const familyB = modelFamily(b)
  if (familyA && familyB && familyA !== familyB) return { relation: 'different', reason: 'family' }

  const qualA = qualifierTokens(a)
  const qualB = qualifierTokens(b)
  const versionA = versionTokens(a)
  const versionB = versionTokens(b)
  const sameVersion =
    versionA.length > 0 &&
    versionA.join('.') === versionB.join('.') &&
    versionA.length === versionB.length
  const sameQualifier = qualA.join(',') === qualB.join(',')

  if (sameVersion && sameQualifier) return { relation: 'related', reason: 'version' }
  if (sameVersion && !sameQualifier) return { relation: 'related', reason: 'qualifier' }
  if (familyA && familyA === familyB) return { relation: 'related', reason: 'family' }
  return { relation: 'related', reason: 'unknown' }
}

/** 从模型自述文本里提取模型名（取首个命中的族关键词及其后紧跟的版本片段） */
export function extractReportedModel(text: string): string | undefined {
  if (!text) return undefined
  const cleaned = text.replace(/[*_`#]/g, ' ')
  for (const { family, re } of FAMILY_PATTERNS) {
    const match = re.exec(cleaned)
    if (!match) continue
    const start = match.index
    // 命中位置往后取一段，形如 "gpt-4o mini" / "claude 3.5 sonnet"
    const tail = cleaned.slice(start, start + 40)
    const token = /^[a-z0-9][a-z0-9.\- :/]{0,32}/i.exec(tail)?.[0] ?? match[0]
    const trimmed = token
      .split(/\s+(?:and|is|the|model|а|和|是)\s+/i)[0]
      .replace(/\s{2,}/g, ' ')
      .replace(/[.,;:!?）)】\]"']+$/, '')
      .trim()
    if (trimmed) return trimmed
    return family
  }
  return undefined
}

export interface DiagnoseSignals {
  configured: string
  /** 接口响应体回显的模型名 */
  served?: string
  /** 模型自述的模型名 */
  reported?: string
  /** 配置的模型是否在 /models 目录中（未查询目录时传 undefined） */
  catalogMatch?: boolean
}

export interface DiagnoseSummary {
  verdict: AiDiagnoseVerdict
  confidence: AiDiagnoseConfidence
  score: number
  servedRelation: ModelRelation
  reportedRelation: ModelRelation
}

const SERVED_WEIGHT: Record<ModelRelation, number> = {
  same: 2,
  related: 1,
  different: -2,
  unknown: 0
}
const REPORTED_WEIGHT: Record<ModelRelation, number> = {
  same: 1,
  related: 0.5,
  different: -1.5,
  unknown: 0
}

/**
 * 综合打分：接口回显（客观）权重最高，自述（主观）次之，目录只作辅助。
 * 得分 >= 2 判定一致，>= 0.5 存疑，其余判定不一致；无任何信号时未知。
 */
export function summarizeDiagnosis(signals: DiagnoseSignals): DiagnoseSummary {
  const servedComparison = signals.served
    ? compareModels(signals.configured, signals.served)
    : { relation: 'unknown' as ModelRelation, reason: 'empty' }
  const reportedComparison = signals.reported
    ? compareModels(signals.configured, signals.reported)
    : { relation: 'unknown' as ModelRelation, reason: 'empty' }

  let score =
    SERVED_WEIGHT[servedComparison.relation] + REPORTED_WEIGHT[reportedComparison.relation]
  if (signals.catalogMatch === true) score += 1
  if (signals.catalogMatch === false) score -= 0.5

  const hasSignal =
    servedComparison.relation !== 'unknown' || reportedComparison.relation !== 'unknown'

  let verdict: AiDiagnoseVerdict
  if (!hasSignal) verdict = 'unknown'
  else if (score >= 2) verdict = 'match'
  else if (score >= 0.5) verdict = 'partial'
  else verdict = 'mismatch'

  let confidence: AiDiagnoseConfidence
  if (servedComparison.relation !== 'unknown' && reportedComparison.relation !== 'unknown') {
    confidence = 'high'
  } else if (servedComparison.relation !== 'unknown') {
    confidence = 'medium'
  } else if (reportedComparison.relation !== 'unknown') {
    confidence = 'low'
  } else {
    confidence = 'low'
  }
  // 结论摇摆（回显与自述互相矛盾）时不该给出高置信度
  if (verdict === 'partial' && confidence === 'high') confidence = 'medium'

  return {
    verdict,
    confidence,
    score,
    servedRelation: servedComparison.relation,
    reportedRelation: reportedComparison.relation
  }
}

/** 从目录里挑出与配置模型同族的条目，帮助用户纠正写错的模型名 */
export function pickSimilarModels(configured: string, catalog: string[], limit = 5): string[] {
  const family = modelFamily(configured)
  if (!family) return []
  const normalized = normalizeModelId(configured)
  const matches = catalog.filter((id) => {
    if (normalizeModelId(id) === normalized) return false
    return modelFamily(id) === family
  })
  return matches.slice(0, limit)
}
