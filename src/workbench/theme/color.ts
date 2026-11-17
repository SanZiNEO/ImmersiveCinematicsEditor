/**
 * 颜色字面量校验与对比度计算（04-07）。
 *
 * 主题只接受 CSS 字面量颜色；`var()` / `url()` / `expression()` / `@import`
 * 一律拒绝，避免主题变成可执行或可远程加载的 CSS。
 */

/** 解析后的 sRGB 颜色。 */
export interface Rgba {
  /** 0–255。 */
  r: number
  /** 0–255。 */
  g: number
  /** 0–255。 */
  b: number
  /** 0–1。 */
  a: number
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FORBIDDEN_PATTERN = /(?:var|url|expression)\s*\(|@import/i
const FUNCTION_PATTERN = /^([a-z][a-z-]*)\s*\(([\s\S]*)\)$/i
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/

/** 是否是可以安全写进 CSS 变量的颜色字面量。 */
export function isColorLiteral(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const text = value.trim()
  if (text.length === 0) {
    return false
  }
  // 分号/花括号会结束或逃出单个声明；换行不是合法颜色的一部分。
  if (/[;{}\r\n]/.test(text)) {
    return false
  }
  if (FORBIDDEN_PATTERN.test(text)) {
    return false
  }
  if (text.toLowerCase() === 'transparent') {
    return true
  }
  if (HEX_PATTERN.test(text)) {
    return true
  }
  const match = FUNCTION_PATTERN.exec(text)
  if (match === null) {
    return false
  }
  const name = match[1].toLowerCase()
  const body = match[2]
  switch (name) {
    case 'rgb':
    case 'rgba':
      return parseRgbFunction(body) !== null
    case 'hsl':
    case 'hsla':
      return parseHslFunction(body) !== null
    default:
      return false
  }
}

/** 颜色 → sRGB；无法解析返回 `null`。 */
export function toRgb(color: string): Rgba | null {
  if (!isColorLiteral(color)) {
    return null
  }
  const text = color.trim()
  const lower = text.toLowerCase()
  if (lower === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  if (text.startsWith('#')) {
    return parseHex(text)
  }
  const match = FUNCTION_PATTERN.exec(text)
  if (match === null) {
    return null
  }
  const name = match[1].toLowerCase()
  if (name === 'rgb' || name === 'rgba') {
    return parseRgbFunction(match[2])
  }
  if (name === 'hsl' || name === 'hsla') {
    return parseHslFunction(match[2])
  }
  return null
}

/** WCAG 相对亮度（忽略 alpha）；无法解析返回 `null`。 */
export function relativeLuminance(color: string | Rgba): number | null {
  const rgb = typeof color === 'string' ? toRgb(color) : color
  if (
    rgb === null ||
    !Number.isFinite(rgb.r) ||
    !Number.isFinite(rgb.g) ||
    !Number.isFinite(rgb.b) ||
    !Number.isFinite(rgb.a)
  ) {
    return null
  }
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = Math.min(255, Math.max(0, channel)) / 255
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** WCAG 对比度（1–21）；任一颜色无法解析返回 `null`。 */
export function contrastRatio(a: string | Rgba, b: string | Rgba): number | null {
  const left = relativeLuminance(a)
  const right = relativeLuminance(b)
  if (left === null || right === null) {
    return null
  }
  const lighter = Math.max(left, right)
  const darker = Math.min(left, right)
  return (lighter + 0.05) / (darker + 0.05)
}

function parseHex(text: string): Rgba | null {
  const raw = text.slice(1)
  if (raw.length === 3) {
    const channels = raw.split('').map((char) => Number.parseInt(char + char, 16))
    return { r: channels[0], g: channels[1], b: channels[2], a: 1 }
  }
  if (raw.length === 6 || raw.length === 8) {
    const r = Number.parseInt(raw.slice(0, 2), 16)
    const g = Number.parseInt(raw.slice(2, 4), 16)
    const b = Number.parseInt(raw.slice(4, 6), 16)
    const a = raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }
  return null
}

interface FunctionArgs {
  channels: string[]
  alpha: string | null
}

function splitFunctionArgs(body: string): FunctionArgs | null {
  const trimmed = body.trim()
  if (trimmed.length === 0) {
    return null
  }
  const slashParts = trimmed.split('/')
  if (slashParts.length > 2) {
    return null
  }
  let alpha: string | null = slashParts.length === 2 ? slashParts[1].trim() : null
  if (alpha !== null && alpha.length === 0) {
    return null
  }
  const main = slashParts[0].trim()
  let tokens: string[]
  if (main.includes(',')) {
    if (/[\s]\s*,|,\s*,/.test(main)) {
      return null
    }
    tokens = main.split(',').map((part) => part.trim())
  } else {
    tokens = main.split(/\s+/).filter((part) => part.length > 0)
  }
  if (tokens.length === 4) {
    if (alpha !== null) {
      return null
    }
    alpha = tokens.pop() ?? null
  }
  if (tokens.length !== 3 || tokens.some((token) => token.length === 0)) {
    return null
  }
  return { channels: tokens, alpha }
}

function parseRgbFunction(body: string): Rgba | null {
  const args = splitFunctionArgs(body)
  if (args === null) {
    return null
  }
  const channels = args.channels.map((token) => parseRgbChannel(token))
  if (channels.some((channel) => channel === null)) {
    return null
  }
  const alpha = args.alpha === null ? 1 : parseAlpha(args.alpha)
  if (alpha === null) {
    return null
  }
  return {
    r: channels[0] as number,
    g: channels[1] as number,
    b: channels[2] as number,
    a: alpha,
  }
}

function parseHslFunction(body: string): Rgba | null {
  const args = splitFunctionArgs(body)
  if (args === null) {
    return null
  }
  const hue = parseHue(args.channels[0])
  const saturation = parsePercentage(args.channels[1])
  const lightness = parsePercentage(args.channels[2])
  const alpha = args.alpha === null ? 1 : parseAlpha(args.alpha)
  if (hue === null || saturation === null || lightness === null || alpha === null) {
    return null
  }
  const rgb = hslToRgb(hue, saturation, lightness)
  return { ...rgb, a: alpha }
}

function parseRgbChannel(token: string): number | null {
  if (token.endsWith('%')) {
    const percent = parseNumber(token.slice(0, -1))
    if (percent === null || percent < 0 || percent > 100) {
      return null
    }
    return Math.round((percent / 100) * 255)
  }
  const value = parseNumber(token)
  if (value === null) {
    return null
  }
  const rounded = Math.round(value)
  if (rounded < 0 || rounded > 255) {
    return null
  }
  return rounded
}

function parseAlpha(token: string): number | null {
  if (token.endsWith('%')) {
    const percent = parseNumber(token.slice(0, -1))
    if (percent === null || percent < 0 || percent > 100) {
      return null
    }
    return percent / 100
  }
  const value = parseNumber(token)
  if (value === null || value < 0 || value > 1) {
    return null
  }
  return value
}

function parseHue(token: string): number | null {
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:deg)?$/i.exec(token.trim())
  if (match === null) {
    return null
  }
  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value)) {
    return null
  }
  return ((value % 360) + 360) % 360
}

function parsePercentage(token: string): number | null {
  if (!token.endsWith('%')) {
    return null
  }
  const value = parseNumber(token.slice(0, -1))
  if (value === null || value < 0 || value > 100) {
    return null
  }
  return value / 100
}

function parseNumber(token: string): number | null {
  const trimmed = token.trim()
  if (!NUMBER_PATTERN.test(trimmed)) {
    return null
  }
  const value = Number.parseFloat(trimmed)
  return Number.isFinite(value) ? value : null
}

function hslToRgb(hue: number, saturation: number, lightness: number): { r: number; g: number; b: number } {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const sector = hue / 60
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1))
  let red = 0
  let green = 0
  let blue = 0
  if (sector < 1) {
    red = chroma
    green = secondary
  } else if (sector < 2) {
    red = secondary
    green = chroma
  } else if (sector < 3) {
    green = chroma
    blue = secondary
  } else if (sector < 4) {
    green = secondary
    blue = chroma
  } else if (sector < 5) {
    red = secondary
    blue = chroma
  } else {
    red = chroma
    blue = secondary
  }
  const match = lightness - chroma / 2
  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  }
}
