/**
 * 快捷命令参数模板：命令正文里可用 `{name}` 表示待填参数。
 *
 * 语法约定：
 * - 占位符名匹配 `[A-Za-z0-9_-]+`
 * - 非法形态（如 `{带空格}`、`{}`）不视为占位符，按普通文本原样保留
 * - 同名占位符只填一次，替换到所有出现位置
 *
 * 参数值原样插入，不做 shell 转义：最终命令会在确认弹窗里完整展示，
 * 由用户复核后再下发；转义反而会让用户看到的命令与实际执行的不一致。
 */

const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_-]+)\}/g

/** 提取命令中的占位符名，按首次出现顺序去重。 */
export function parseSnippetPlaceholders(command: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  PLACEHOLDER_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PLACEHOLDER_PATTERN.exec(command)) !== null) {
    const name = match[1]
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/** 把命令中的占位符替换为给定值；未提供的占位符替换为空字符串。 */
export function applySnippetPlaceholders(command: string, values: Record<string, string>): string {
  PLACEHOLDER_PATTERN.lastIndex = 0
  return command.replace(PLACEHOLDER_PATTERN, (_all, name: string) => values[name] ?? '')
}
