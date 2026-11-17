/**
 * 主题校验（04-07）。
 *
 * 与运行时注册表解耦：只判断输入能否成为 `ThemeDefinition`。
 * 缺失的核心 token 允许（交给同 appearance 的内置主题继承），
 * 但“全部核心 token 都缺”和任何非法颜色都直接拒绝。
 */
import {
  CORE_THEME_TOKENS,
  OPTIONAL_THEME_TOKENS,
  SYNTAX_TOKENS,
  TRACK_TOKENS,
} from '../api/theme.ts'
import type {
  SyntaxToken,
  ThemeAppearance,
  ThemeDefinition,
  ThemePreview,
  ThemeTokens,
  TrackToken,
} from '../api/theme.ts'
import { THEME_ID_PATTERN } from '../api/ids.ts'
import { contrastRatio, isColorLiteral } from './color.ts'

/** 校验选项。 */
export interface ThemeValidationOptions {
  /** 要求 ID 以此前缀开头（用户导入主题用 `user.`）。 */
  idPrefix?: string
  /** 序列化后的字节上限。 */
  maxBytes?: number
}

/** 校验结果；`ok` 为真时 `theme` 是规范化后的纯数据。 */
export interface ThemeValidationResult {
  ok: boolean
  theme?: ThemeDefinition
  issues: string[]
}

const APPEARANCES: readonly ThemeAppearance[] = ['dark', 'light', 'high-contrast'] as const
const TOKEN_KEYS: Readonly<Record<string, true>> = Object.fromEntries(
  [...CORE_THEME_TOKENS, ...OPTIONAL_THEME_TOKENS].map((token) => [token, true]),
)
const CORE_KEYS: Readonly<Record<string, true>> = Object.fromEntries(
  CORE_THEME_TOKENS.map((token) => [token, true]),
)
const SYNTAX_KEYS: Readonly<Record<string, true>> = Object.fromEntries(
  SYNTAX_TOKENS.map((token) => [token, true]),
)
const TRACK_KEYS: Readonly<Record<string, true>> = Object.fromEntries(
  TRACK_TOKENS.map((token) => [token, true]),
)
const PREVIEW_FIELDS: readonly (keyof ThemePreview)[] = ['bg', 'panel', 'text', 'accent'] as const

function measuredBytes(input: unknown): number {
  if (typeof input === 'string') {
    return new TextEncoder().encode(input).length
  }
  try {
    const serialized = JSON.stringify(input)
    return serialized === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(serialized).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

interface ColorTokenMapResult {
  entries?: Record<string, string>
  error?: string
}

function readColorTokenMap(
  value: unknown,
  allowed: Readonly<Record<string, true>>,
  field: string,
): ColorTokenMapResult {
  if (value === undefined) {
    return {}
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: `${field} 必须是对象` }
  }
  const entries: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!Object.hasOwn(allowed, key)) {
      return { error: `${field} 含未知 token：${key}` }
    }
    if (!isColorLiteral(raw)) {
      return { error: `${field}.${key} 的颜色非法：${String(raw)}` }
    }
    entries[key] = raw.trim()
  }
  return { entries }
}

interface PreviewResult {
  preview?: ThemePreview
  error?: string
}

function readPreview(value: unknown): PreviewResult {
  if (value === undefined) {
    return {}
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'preview 必须是对象' }
  }
  const record = value as Record<string, unknown>
  const preview = {} as ThemePreview
  for (const field of PREVIEW_FIELDS) {
    const raw = record[field]
    if (!isColorLiteral(raw)) {
      return { error: `preview.${field} 的颜色非法` }
    }
    preview[field] = raw.trim()
  }
  return { preview }
}

/** 校验主题包。非法输入返回 `ok: false` 与逐条原因；警告不阻止应用。 */
export function validateTheme(
  input: unknown,
  opts: ThemeValidationOptions = {},
): ThemeValidationResult {
  const issues: string[] = []
  const reject = (message: string): ThemeValidationResult => {
    issues.push(`error: ${message}`)
    return { ok: false, issues }
  }

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return reject('主题必须是对象')
  }
  const record = input as Record<string, unknown>
  if (opts.maxBytes !== undefined && measuredBytes(record) > opts.maxBytes) {
    return reject(`主题超过大小上限 ${opts.maxBytes} 字节`)
  }
  if (record.version !== 1) {
    return reject(`不支持的 version：${String(record.version)}`)
  }

  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!THEME_ID_PATTERN.test(id)) {
    return reject(`主题 ID 非法：${String(record.id)}`)
  }
  if (opts.idPrefix !== undefined && !id.startsWith(opts.idPrefix)) {
    return reject(`主题 ID 必须以 ${opts.idPrefix} 开头`)
  }

  const label = typeof record.label === 'string' ? record.label.trim() : ''
  const labelKey = typeof record.labelKey === 'string' ? record.labelKey.trim() : ''
  if (label.length === 0 && labelKey.length === 0) {
    return reject('缺少 label 或 labelKey')
  }

  const appearance = record.appearance
  if (typeof appearance !== 'string' || !APPEARANCES.includes(appearance as ThemeAppearance)) {
    return reject(`appearance 非法：${String(appearance)}`)
  }

  const rawTokens = record.tokens
  if (typeof rawTokens !== 'object' || rawTokens === null || Array.isArray(rawTokens)) {
    return reject('tokens 必须是对象')
  }
  const tokens: Record<string, string> = {}
  let coreTokenCount = 0
  for (const [key, raw] of Object.entries(rawTokens)) {
    if (!Object.hasOwn(TOKEN_KEYS, key)) {
      return reject(`未知 token：${key}`)
    }
    if (!isColorLiteral(raw)) {
      return reject(`token "${key}" 的颜色非法：${String(raw)}`)
    }
    tokens[key] = raw.trim()
    if (Object.hasOwn(CORE_KEYS, key)) {
      coreTokenCount += 1
    }
  }
  if (coreTokenCount === 0) {
    return reject('tokens 缺少全部核心 token')
  }

  const syntax = readColorTokenMap(record.syntaxTokens, SYNTAX_KEYS, 'syntaxTokens')
  if (syntax.error !== undefined) {
    return reject(syntax.error)
  }
  const track = readColorTokenMap(record.trackTokens, TRACK_KEYS, 'trackTokens')
  if (track.error !== undefined) {
    return reject(track.error)
  }
  const preview = readPreview(record.preview)
  if (preview.error !== undefined) {
    return reject(preview.error)
  }

  const panel = tokens['bg-panel']
  const text = tokens.text
  if (panel !== undefined && text !== undefined) {
    const ratio = contrastRatio(text, panel)
    if (ratio === null) {
      return reject('无法计算 text / bg-panel 对比度')
    }
    if (appearance === 'high-contrast') {
      if (ratio < 7) {
        return reject(`高对比主题 text / bg-panel 对比 ${ratio.toFixed(2)}:1，低于 7:1`)
      }
    } else if (ratio < 4.5) {
      issues.push(`warning: text / bg-panel 对比 ${ratio.toFixed(2)}:1，低于 4.5:1`)
    }
  }
  if (appearance === 'high-contrast' && panel !== undefined && tokens['text-secondary'] !== undefined) {
    const ratio = contrastRatio(tokens['text-secondary'], panel)
    if (ratio === null) {
      return reject('无法计算 text-secondary / bg-panel 对比度')
    }
    if (ratio < 4.5) {
      return reject(`高对比主题 text-secondary / bg-panel 对比 ${ratio.toFixed(2)}:1，低于 4.5:1`)
    }
  }
  if (panel !== undefined) {
    for (const key of ['focus', 'border-strong'] as const) {
      const value = tokens[key]
      if (value === undefined) {
        continue
      }
      const ratio = contrastRatio(value, panel)
      if (ratio === null) {
        return reject(`无法计算 ${key} / bg-panel 对比度`)
      }
      if (ratio < 3) {
        return reject(`${key} / bg-panel 对比 ${ratio.toFixed(2)}:1，低于 3:1`)
      }
    }
  }

  const theme: ThemeDefinition = {
    version: 1,
    id,
    label: label.length > 0 ? label : labelKey,
    appearance: appearance as ThemeAppearance,
    tokens: tokens as Partial<ThemeTokens>,
  }
  if (labelKey.length > 0) {
    theme.labelKey = labelKey
  }
  if (syntax.entries !== undefined) {
    theme.syntaxTokens = syntax.entries as Partial<Record<SyntaxToken, string>>
  }
  if (track.entries !== undefined) {
    theme.trackTokens = track.entries as Partial<Record<TrackToken, string>>
  }
  if (preview.preview !== undefined) {
    theme.preview = preview.preview
  }
  return { ok: true, theme, issues }
}
