/**
 * 字幕文件解析（12-12）：SRT / VTT 纯函数解析。
 *
 * 口径（对照 plan/12/12-12 与运行时事实）：
 * - SRT：空行分块；时间行逗号毫秒；小时可超两位；毫秒补齐；序号行可无；多行文本保留；
 *   空文本 / 结束 ≤ 开始 / 时间行缺失标 error；样式标签去标记并提示。
 * - VTT：标识行；前导空行与 BOM；注释 / 样式 / 区域块跳过；cue 可选标识；带小时与不带
 *   小时两种时间写法；设置项整段忽略并计数；标记去除只留可读文本；常见实体解码一次；
 *   无 cue 视为错误，不生成空批次。
 * - `@lang:` 首字符前缀转义成 `@@lang:`；本身双 `@` 给警告不改写；只处理开头，正文中间不动。
 *
 * 本模块不碰文档 / 宿主；解码在 `decode.ts` 与主进程 IPC。
 */
import { LANG_ESCAPED_PREFIX, LANG_PREFIX } from '../overlay/subtitle.ts'

/** 单条解析问题。 */
export interface ParseIssue {
  cueOrdinal?: number
  message: string
}

/** 解析出的单条 cue（草稿形态，尚未编译成片段）。 */
export interface ParsedCue {
  /** 文件内顺序号（从 1 开始）。 */
  ordinal: number
  start: number
  end: number
  /** 去标记 / 实体解码 / 前缀转义后的可读文本（保留 `\n` 分行）。 */
  text: string
  /** 原始文本（诊断用，未去标记）。 */
  sourceText: string
  format: 'srt' | 'vtt'
  /** 阻塞级错误（空文本 / 时间非法 / 结束 ≤ 开始等）。 */
  error?: string
  warnings: string[]
}

/** 整份解析结果。 */
export interface SubtitleParseOutput {
  format: 'srt' | 'vtt'
  cues: ParsedCue[]
  errors: ParseIssue[]
  warnings: ParseIssue[]
  /** VTT 被忽略的 cue 设置项数量。 */
  ignoredSettings: number
  /** 没有任何 cue（VTT 无 cue / SRT 空文件）。 */
  empty: boolean
}

// ── 时间解析 ────────────────────────────────────────────────────────────────────

const SRT_TIME_LINE = /^(\d+):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?\s*-->\s*(\d+):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?(.*)$/
const VTT_TIME_LINE = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?(.*)$/

/** 把 `HH? : MM : SS , mmm` 解析成秒；非法返回 `null`。 */
function parseTimestamp(
  hours: string | undefined,
  minutes: string,
  seconds: string,
  millis: string | undefined,
): number | null {
  const h = Number(hours ?? '0')
  const m = Number(minutes)
  const s = Number(seconds)
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null
  if (m < 0 || m > 59 || s < 0 || s > 59) return null
  const msText = (millis ?? '').padEnd(3, '0').slice(0, 3)
  const ms = Number(msText)
  if (!Number.isFinite(ms)) return null
  return h * 3600 + m * 60 + s + ms / 1000
}

interface TimeMatch {
  start: number
  end: number
  settings: string
}

function matchSrtTime(line: string): TimeMatch | null {
  const match = SRT_TIME_LINE.exec(line.trim())
  if (match === null) return null
  const start = parseTimestamp(match[1], match[2], match[3], match[4])
  const end = parseTimestamp(match[5], match[6], match[7], match[8])
  if (start === null || end === null) return null
  return { start, end, settings: match[9]?.trim() ?? '' }
}

function matchVttTime(line: string): TimeMatch | null {
  const match = VTT_TIME_LINE.exec(line.trim())
  if (match === null) return null
  const start = parseTimestamp(match[1], match[2], match[3], match[4])
  const end = parseTimestamp(match[5], match[6], match[7], match[8])
  if (start === null || end === null) return null
  return { start, end, settings: match[9]?.trim() ?? '' }
}

// ── 文本清洗 ──────────────────────────────────────────────────────────────────────

const MARKUP_TAG = /<[^>]*>/g

const ENTITY_DECODE: ReadonlyArray<[RegExp, string]> = [
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&nbsp;/g, ' '],
]

/** 去除样式标签；返回清洗后文本与是否去掉过标记。 */
function stripMarkup(raw: string): { text: string; stripped: boolean } {
  let stripped = false
  const text = raw.replace(MARKUP_TAG, () => {
    stripped = true
    return ''
  })
  return { text, stripped }
}

/** 常见实体只解码一次（不反复解码 `&amp;amp;`）。 */
function decodeEntities(text: string): string {
  let out = text
  for (const [pattern, replacement] of ENTITY_DECODE) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/**
 * 开头 `@lang:` 前缀处理：
 * - `@@lang:` → 保留，给警告（双 @ 是作者显式转义，不改写）；
 * - `@lang:` → 转义成 `@@lang:`；
 * - 只处理开头，正文中间的 `@` 不动。
 */
function normalizeLangPrefix(text: string): { text: string; warning?: string } {
  if (text.startsWith(LANG_ESCAPED_PREFIX)) {
    return { text, warning: '双 @ 前缀按转义保留，未改写' }
  }
  if (text.startsWith(LANG_PREFIX)) {
    return { text: `@${text}` }
  }
  return { text }
}

/** 清洗一条 cue 的正文：去标记 → 实体解码 → 前缀转义。 */
function cleanCueText(raw: string): { text: string; warnings: string[] } {
  const warnings: string[] = []
  const markup = stripMarkup(raw)
  if (markup.stripped) warnings.push('样式标记已去除，只保留可读文本')
  const entities = decodeEntities(markup.text)
  const lang = normalizeLangPrefix(entities)
  if (lang.warning !== undefined) warnings.push(lang.warning)
  return { text: lang.text, warnings }
}

// ── 公共组装 ──────────────────────────────────────────────────────────────────────

function makeCue(
  ordinal: number,
  format: 'srt' | 'vtt',
  time: TimeMatch | null,
  rawText: string,
  issues: ParseIssue[],
  warnings: ParseIssue[],
): ParsedCue {
  const cleaned = cleanCueText(rawText)
  const cue: ParsedCue = {
    ordinal,
    start: time?.start ?? Number.NaN,
    end: time?.end ?? Number.NaN,
    text: cleaned.text,
    sourceText: rawText,
    format,
    warnings: cleaned.warnings,
  }
  if (time === null) {
    cue.error = '时间行缺失或格式非法'
    issues.push({ cueOrdinal: ordinal, message: cue.error })
  } else if (time.end <= time.start) {
    cue.error = '结束时间不晚于开始时间'
    issues.push({ cueOrdinal: ordinal, message: cue.error })
  } else if (cleaned.text.trim() === '') {
    cue.error = '文本为空'
    issues.push({ cueOrdinal: ordinal, message: cue.error })
  }
  for (const warning of cleaned.warnings) {
    warnings.push({ cueOrdinal: ordinal, message: warning })
  }
  return cue
}

function splitBlocks(text: string): string[] {
  return text
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
}

// ── SRT ───────────────────────────────────────────────────────────────────────────

function parseSrt(text: string): SubtitleParseOutput {
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []
  const cues: ParsedCue[] = []
  const blocks = splitBlocks(text)

  blocks.forEach((block, blockIndex) => {
    const lines = block.split('\n').map((line) => line.replace(/[ \t]+$/, ''))
    let cursor = 0
    // 可选序号行：纯数字。
    if (/^\d+$/.test(lines[0]?.trim() ?? '')) {
      cursor = 1
    }
    const timeIndex = lines.findIndex((line, index) => index >= cursor && matchSrtTime(line) !== null)
    const ordinal = blockIndex + 1
    if (timeIndex === -1) {
      const rawText = lines.slice(cursor).join('\n')
      cues.push(makeCue(ordinal, 'srt', null, rawText, errors, warnings))
      return
    }
    const time = matchSrtTime(lines[timeIndex])
    const rawText = lines.slice(timeIndex + 1).join('\n')
    cues.push(makeCue(ordinal, 'srt', time, rawText, errors, warnings))
  })

  return { format: 'srt', cues, errors, warnings, ignoredSettings: 0, empty: cues.length === 0 }
}

// ── VTT ───────────────────────────────────────────────────────────────────────────

function parseVtt(text: string): SubtitleParseOutput {
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []
  const cues: ParsedCue[] = []
  let ignoredSettings = 0

  const allLines = text.split('\n')


  const firstNonEmpty = allLines.findIndex((line) => line.trim() !== '')
  if (firstNonEmpty === -1 || !allLines[firstNonEmpty].trimStart().startsWith('WEBVTT')) {
    errors.push({ message: 'VTT 缺少 WEBVTT 标识行' })
    return { format: 'vtt', cues, errors, warnings, ignoredSettings: 0, empty: true }
  }

  const blocks = splitBlocks(allLines.slice(firstNonEmpty + 1).join('\n'))
  let ordinal = 0
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.replace(/[ \t]+$/, ''))
    const head = lines[0]?.trim() ?? ''
    if (head === 'NOTE' || head.startsWith('NOTE ')) continue
    if (head === 'STYLE' || head.startsWith('STYLE ')) continue
    if (head === 'REGION' || head.startsWith('REGION ')) continue

    const timeIndex = lines.findIndex((line) => matchVttTime(line) !== null)
    ordinal += 1
    if (timeIndex === -1) {
      const rawText = lines.join('\n')
      cues.push(makeCue(ordinal, 'vtt', null, rawText, errors, warnings))
      continue
    }
    const time = matchVttTime(lines[timeIndex])
    if (time !== null && time.settings.length > 0) {
      ignoredSettings += 1
      warnings.push({ cueOrdinal: ordinal, message: 'cue 设置项已整段忽略' })
    }
    const rawText = lines.slice(timeIndex + 1).join('\n')
    cues.push(makeCue(ordinal, 'vtt', time, rawText, errors, warnings))
  }

  if (cues.length === 0) {
    errors.push({ message: 'VTT 没有可用 cue' })
  }
  return { format: 'vtt', cues, errors, warnings, ignoredSettings, empty: cues.length === 0 }
}

// ── 入口 ──────────────────────────────────────────────────────────────────────────

/** 重导入比较用：去标记 + 实体解码 + 首尾空白；不做前缀转义。 */
export function normalizeComparableText(raw: string): string {
  return decodeEntities(stripMarkup(raw).text).trim()
}

/** 按扩展名判断格式；无法判断返回 `null`。 */
export function subtitleFormatOf(fileName: string): 'srt' | 'vtt' | null {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'srt') return 'srt'
  if (ext === 'vtt') return 'vtt'
  return null
}

/**
 * 解析字幕文本（已解码为字符串）。
 *
 * @param text 解码后的文件正文。
 * @param format 格式（由扩展名决定）；缺省按内容嗅探。
 */
export function parseSubtitleText(text: string, format?: 'srt' | 'vtt'): SubtitleParseOutput {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const detected: 'srt' | 'vtt' = format ?? (normalized.includes('-->') && /WEBVTT/.test(normalized) ? 'vtt' : 'srt')
  return detected === 'vtt' ? parseVtt(normalized) : parseSrt(normalized)
}
