/** 搜索关键字长度上限 */
export const MAX_KEYWORD_LENGTH = 64
/** find 命令最长递归深度 */
export const MAX_FIND_DEPTH = 12
/** find 命令最多返回的条目数 */
export const MAX_FIND_LINES = 500

/** shell 单引号转义 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** glob 元字符转义，使关键字按字面量匹配 */
export function escapeGlob(value: string): string {
  return value.replace(/([*?\[\]\\])/g, '\\$1')
}

/**
 * 关键字合法性：只允许普通名字字符，长度受限。
 * 控制字符与 shell 元字符一律拒绝，避免命令注入。
 */
export function isValidSearchKeyword(keyword: string): boolean {
  if (keyword.length === 0 || keyword.length > MAX_KEYWORD_LENGTH) return false
  return !/[\x00-\x1f\x7f'\"`$;\\|&<>(){}]/.test(keyword)
}

/**
 * 构造远端查找命令。
 *
 * 堡垒机会限制单会话的通道数，能力探测与正式搜索必须共用一个 exec 通道，
 * 因此用 shell 的 if/else 在同一条命令里完成 -printf 支持探测与回退：
 * GNU find 走 -printf（带类型信息），BSD find 回退到 -print。
 */
export function buildFindCommand(
  root: string,
  keyword: string,
  maxDepth: number = MAX_FIND_DEPTH,
  maxLines: number = MAX_FIND_LINES
): string {
  const quotedRoot = shellQuote(root)
  const quotedPattern = shellQuote(`*${escapeGlob(keyword)}*`)
  const search = `find ${quotedRoot} -maxdepth ${maxDepth} -iname ${quotedPattern}`
  return (
    `if find ${quotedRoot} -maxdepth 1 -iname ${quotedPattern} -printf '%y\\n' >/dev/null 2>&1; ` +
    `then ${search} -printf '%y\\t%p\\n' 2>/dev/null | head -n ${maxLines}; ` +
    `else ${search} -print 2>/dev/null | head -n ${maxLines}; fi`
  )
}
