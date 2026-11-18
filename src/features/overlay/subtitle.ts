/**
 * 字幕层文本（09-05）。
 *
 * 事实基准：
 * - `overlay/SubtitleLayer.java`：`text.split("\n", -1)`（末尾空行保留）；
 *   字块宽 = 最长行宽 × fontScale × k，高 = 行数 × `font.lineHeight` × fontScale × k；
 *   不自动换行；`opacity <= 0.001` 或 `alpha = opacity*255 < 4` 时不绘制（MC 的 alpha 补齐坑）。
 * - `util/LangResources.java`：字段以 `@lang:` 开头才查表；`@@lang:` 转义输出字面量；
 *   key = 1..32 位的 `[a-zA-Z0-9_]` 段用 `.` 连接；回退链 = 当前语言 → `en_us` → 原样引用串。
 *
 * 本模块只做文本/布局估算与预览解析；写文档由调用方走命令层。
 */
import { explicitValue } from './layers.ts'
import type { JsonObject } from '../../core/doc/types.ts'

/** `@lang:` 引用前缀（与运行时一致）。 */
export const LANG_PREFIX = '@lang:'
/** `@@lang:` 转义前缀（输出去掉一个 `@`）。 */
export const LANG_ESCAPED_PREFIX = '@@lang:'
/** 回退语言。 */
export const LANG_FALLBACK = 'en_us'
/** key 段正则（与 `LangResources.KEY_PATTERN` 一致）。 */
const KEY_PATTERN = /^[a-zA-Z0-9_]{1,32}(?:\.[a-zA-Z0-9_]{1,32})*$/
/** key 总长上限。 */
const MAX_KEY_LENGTH = 256

/** 读 `text` 的显式值（缺失 / 非字符串 → 空串）。 */
export function subtitleTextOf(objects: JsonObject): string {
  const explicit = explicitValue(objects, 'text')
  return explicit.present && typeof explicit.value === 'string' ? explicit.value : ''
}

/** 是否 `@lang:` 引用（不是 `@@lang:` 转义）。 */
export function isLangReference(raw: string): boolean {
  return raw.startsWith(LANG_PREFIX) && !raw.startsWith(LANG_ESCAPED_PREFIX)
}

/** 是否 `@@lang:` 转义串。 */
export function isEscapedLangLiteral(raw: string): boolean {
  return raw.startsWith(LANG_ESCAPED_PREFIX)
}

/** 提取引用 key；非法或不是引用返回 `null`。 */
export function langKeyOf(raw: string): string | null {
  if (!isLangReference(raw)) {
    return null
  }
  const key = raw.slice(LANG_PREFIX.length)
  if (key.length === 0 || key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) {
    return null
  }
  return key
}

/** 语言字典：语言代码 → {key: 译文}。 */
export type LangDictionaries = Record<string, Record<string, string>>

/**
 * 解析文本的**运行时**语义（用于预览，不写盘）。
 *
 * - `@@lang:x` → `@lang:x`
 * - 非引用 → 原样
 * - 非法 key → 原样引用串
 * - 命中当前语言 → 译文；否则 `en_us`；再否则原样引用串
 */
export function resolveLangText(raw: string, dictionaries: LangDictionaries, language: string): string {
  if (isEscapedLangLiteral(raw)) {
    return raw.slice(1)
  }
  if (!isLangReference(raw)) {
    return raw
  }
  const key = langKeyOf(raw)
  if (key === null) {
    return raw
  }
  const current = dictionaries[language]?.[key]
  if (current !== undefined) {
    return current
  }
  const fallback = dictionaries[LANG_FALLBACK]?.[key]
  if (fallback !== undefined) {
    return fallback
  }
  return raw
}

/** 预览结果分类（UI 用来标「命中 / 回落 / 未命中 / 转义 / 字面」）。 */
export type LangPreviewKind = 'literal' | 'escaped' | 'key' | 'invalid-key' | 'resolved' | 'fallback' | 'missing'

export interface LangPreview {
  kind: LangPreviewKind
  /** 原值。 */
  raw: string
  /** 预览文本。 */
  text: string
  /** 引用 key（仅引用形态）。 */
  key: string | null
}

/** 字幕预览：区分「命中当前语言 / 回退 en_us / 未命中 / 非法 key / 转义 / 字面」。 */
export function previewSubtitleText(raw: string, dictionaries: LangDictionaries, language: string): LangPreview {
  if (isEscapedLangLiteral(raw)) {
    const text = raw.slice(1)
    return { kind: 'escaped', raw, text, key: langKeyOf(text) }
  }
  if (!isLangReference(raw)) {
    return { kind: 'literal', raw, text: raw, key: null }
  }
  const key = langKeyOf(raw)
  if (key === null) {
    return { kind: 'invalid-key', raw, text: raw, key: raw.slice(LANG_PREFIX.length) }
  }
  const current = dictionaries[language]?.[key]
  if (current !== undefined) {
    return { kind: 'resolved', raw, text: current, key }
  }
  const fallback = dictionaries[LANG_FALLBACK]?.[key]
  if (fallback !== undefined) {
    return { kind: 'fallback', raw, text: fallback, key }
  }
  return { kind: 'missing', raw, text: raw, key }
}

/** 分行（与 Java `split("\n", -1)` 一致：末尾空行保留，空串 = 1 行）。 */
export function splitSubtitleLines(text: string): string[] {
  return text.split('\n')
}

/** 粗略字符宽度（MC 字体：ASCII 约 6px，CJK 约 9px；仅用于面板估算）。 */
export function estimateCharWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0
  return code >= 0x2e80 ? 9 : 6
}

/** 估算一行宽度（像素，fontScale=1 的基准）。 */
export function estimateLineWidth(line: string): number {
  let width = 0
  for (const char of line) {
    width += estimateCharWidth(char)
  }
  return width
}

/** 字幕块估算结果（基准像素，fontScale=1；实际尺寸还要 × fontScale × scale × 分辨率转义 k）。 */
export interface SubtitleLayoutEstimate {
  lines: string[]
  /** 最长行宽（基线像素）。 */
  maxLineWidth: number
  /** 行高（基线像素；原版字体 `lineHeight` = 9）。 */
  lineHeight: number
  /** 总高（行数 × 行高）。 */
  totalHeight: number
  /** 末尾空行数（提示"末尾空行增加高度"）。 */
  trailingEmptyLines: number
  /** 是否超宽（× fontScale × scaleX 后 > 屏幕宽）。 */
  overflowX: boolean
  /** 是否超高（× fontScale × scaleY 后 > 屏幕高）。 */
  overflowY: boolean
  /** 实际显示宽（含 fontScale / scale / 转义）。 */
  displayWidth: number
  /** 实际显示高。 */
  displayHeight: number
  /** 估算所用屏幕宽（提示文案用）。 */
  screenWidth: number
  /** 估算所用屏幕高。 */
  screenHeight: number
}

/** MC 原版字体行高（`font.lineHeight` = 9）。 */
export const SUBTITLE_LINE_HEIGHT = 9

/** 估算字幕块尺寸（09-03 geometry 的文本分支）。 */
export function estimateSubtitleLayout(input: {
  text: string
  fontScale: number
  scaleX: number
  scaleY: number
  screenWidth: number
  screenHeight: number
  /** 分辨率转义 k（默认 1）。 */
  resolutionEscape?: number
}): SubtitleLayoutEstimate {
  const lines = splitSubtitleLines(input.text)
  const maxLineWidth = lines.reduce((max, line) => Math.max(max, estimateLineWidth(line)), 0)
  const lineHeight = SUBTITLE_LINE_HEIGHT
  const totalHeight = lines.length * lineHeight
  let trailingEmptyLines = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index] !== '') {
      break
    }
    trailingEmptyLines += 1
  }
  const k = input.resolutionEscape ?? 1
  const displayWidth = maxLineWidth * input.fontScale * input.scaleX * k
  const displayHeight = totalHeight * input.fontScale * input.scaleY * k
  return {
    lines,
    maxLineWidth,
    lineHeight,
    totalHeight,
    trailingEmptyLines,
    overflowX: displayWidth > input.screenWidth,
    overflowY: displayHeight > input.screenHeight,
    displayWidth,
    displayHeight,
    screenWidth: input.screenWidth,
    screenHeight: input.screenHeight,
  }
}

/** alpha 不可见判定（09-05 §4.4：与 `SubtitleLayer` 同口径）。 */
export function subtitleInvisible(opacity: number): { invisible: boolean; reason: string | null } {
  if (!Number.isFinite(opacity)) {
    return { invisible: true, reason: 'opacity 不是有限数：运行时不绘制' }
  }
  if (opacity <= 0.001) {
    return { invisible: true, reason: 'opacity ≤ 0.001：低于可见阈值，运行时不绘制' }
  }
  if (Math.floor(opacity * 255) < 4) {
    return {
      invisible: true,
      reason: 'opacity × 255 < 4：MC 字体 alpha 会被补成不透明，运行时直接跳过（该区间不可见）',
    }
  }
  return { invisible: false, reason: null }
}

/** 字幕面板提示：空文本 / 低透明度 / 末尾空行 / 超宽。 */
export function subtitleHints(layout: SubtitleLayoutEstimate, opacity: number): string[] {
  const hints: string[] = []
  if (layout.lines.every((line) => line === '')) {
    hints.push('文本为空：运行时不绘制（不影响图片/视频层的空路径规则）')
  }
  const invisible = subtitleInvisible(opacity)
  if (invisible.invisible && invisible.reason !== null) {
    hints.push(invisible.reason)
  }
  if (layout.trailingEmptyLines > 0) {
    hints.push(`末尾有 ${layout.trailingEmptyLines} 个空行：会按行高增加文字块高度`)
  }
  if (layout.overflowX) {
    hints.push(`估算宽度 ${layout.displayWidth.toFixed(0)}px 超过屏幕宽度 ${layout.screenWidth}px（运行时不自动换行，会溢出裁切）`)
  }
  if (layout.overflowY) {
    hints.push(`估算高度 ${layout.displayHeight.toFixed(0)}px 超过屏幕高度 ${layout.screenHeight}px`)
  }
  return hints
}

/** 语言文件清单中的 key 建议（前缀匹配，最多 `limit` 条）。 */
export function suggestLangKeys(keys: readonly string[], prefix: string, limit = 12): string[] {
  const needle = prefix.startsWith(LANG_PREFIX) ? prefix.slice(LANG_PREFIX.length) : prefix
  const lower = needle.toLowerCase()
  const matches = keys.filter((key) => key.toLowerCase().includes(lower))
  matches.sort((left, right) => {
    const leftStarts = left.toLowerCase().startsWith(lower) ? 0 : 1
    const rightStarts = right.toLowerCase().startsWith(lower) ? 0 : 1
    return leftStarts - rightStarts || left.localeCompare(right)
  })
  return matches.slice(0, limit)
}

/** 把文本写成 `@@lang:` 转义（当作者要显示字面 `@lang:` 时）。 */
export function escapeLangLiteral(raw: string): string {
  return raw.startsWith('@lang:') ? `@${raw}` : raw
}

/** 字幕文本写入检查（空串允许：运行时不绘制；只拒绝非字符串）。 */
export function validateSubtitleText(input: string): { ok: boolean; message?: string } {
  if (typeof input !== 'string') {
    return { ok: false, message: 'text 必须是字符串' }
  }
  if (input.includes('\r')) {
    return { ok: false, message: 'text 不允许 CR：换行请用 \\n（运行时按 \\n 分行）' }
  }
  return { ok: true }
}
