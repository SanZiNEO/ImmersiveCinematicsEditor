/**
 * 快捷键 chord 解析、归一与匹配（04-10）。
 *
 * 纯逻辑：不访问 `document` / `window`，键盘事件由调用方适配成 `KeyEventLike`。
 * `Mod` 是平台抽象：win32/linux 表示 Ctrl，darwin 表示 Cmd；`normalizeChord`
 * 保留 `mod` 记号，`resolveModChord` 在需要物理比较时按平台展开。
 */
import type { KeyEventLike } from '../api/commands.ts'

/** chord.ts 支持的平台集合。 */
export type ChordPlatform = 'win32' | 'darwin' | 'linux'

/** chord 的规范化形态：主键小写，修饰词为布尔位。 */
export interface ChordSpec {
  readonly mod: boolean
  readonly ctrl: boolean
  readonly meta: boolean
  readonly alt: boolean
  readonly shift: boolean
  /** 小写主键；如 `s` / `f6` / `arrowleft` / `escape` / `,`。 */
  readonly key: string
}

type ModifierName = 'mod' | 'ctrl' | 'meta' | 'alt' | 'shift'

type MutableModifiers = Record<ModifierName, boolean>

/** 修饰词别名；解析不区分大小写。 */
const MODIFIER_ALIASES: Readonly<Record<string, ModifierName>> = {
  mod: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
}

/** 主键别名；归一后同一物理键得到同一字符串。 */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  escape: 'escape',
  space: 'space',
  spacebar: 'space',
  left: 'arrowleft',
  arrowleft: 'arrowleft',
  right: 'arrowright',
  arrowright: 'arrowright',
  up: 'arrowup',
  arrowup: 'arrowup',
  down: 'arrowdown',
  arrowdown: 'arrowdown',
  del: 'delete',
  delete: 'delete',
  backspace: 'backspace',
  return: 'enter',
  enter: 'enter',
  tab: 'tab',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  insert: 'insert',
  comma: ',',
  period: '.',
  dot: '.',
  slash: '/',
  backslash: '\\',
  minus: '-',
  hyphen: '-',
  equal: '=',
  equals: '=',
  backquote: '`',
  grave: '`',
  semicolon: ';',
  quote: "'",
  apostrophe: "'",
  bracketleft: '[',
  bracketright: ']',
}

/** 规范化的修饰词顺序；保证同一物理键得到同一字符串。 */
const MODIFIER_ORDER: readonly ModifierName[] = ['mod', 'ctrl', 'alt', 'shift', 'meta']

/** 展示用主键名。 */
const KEY_DISPLAY: Readonly<Record<string, string>> = {
  escape: 'Esc',
  space: 'Space',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  delete: 'Delete',
  backspace: 'Backspace',
  enter: 'Enter',
  tab: 'Tab',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
}

/** 归一单个主键 token；空串 / 非法 token 返回 `null`。 */
function normalizeKeyToken(token: string): string | null {
  if (token === ' ') return 'space'
  const trimmed = token.trim()
  if (trimmed.length === 0) return null
  if (/\s/.test(trimmed)) return null
  const lower = trimmed.toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

/** 解析 chord 文本；无法解析返回 `null`。 */
export function parseChord(text: string): ChordSpec | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null

  const tokens = trimmed.split('+')
  const mainRaw = tokens[tokens.length - 1]
  if (mainRaw === undefined) return null

  const main = normalizeKeyToken(mainRaw)
  if (main === null) return null
  // 单独一个修饰词不是合法主键（例如 `Shift`）。
  if (MODIFIER_ALIASES[main] !== undefined && KEY_ALIASES[main] === undefined) return null

  const flags: MutableModifiers = { mod: false, ctrl: false, meta: false, alt: false, shift: false }
  for (const raw of tokens.slice(0, -1)) {
    const token = raw.trim()
    if (token.length === 0) return null
    const modifier = MODIFIER_ALIASES[token.toLowerCase()]
    if (modifier === undefined) return null
    // `Mod` 与 `Ctrl` / `Cmd` 同时出现时物理含义不明确，直接拒绝。
    if (modifier === 'mod' && (flags.ctrl || flags.meta)) return null
    if ((modifier === 'ctrl' || modifier === 'meta') && flags.mod) return null
    flags[modifier] = true
  }

  return { ...flags, key: main }
}

/** chord 的规范字符串（主键小写、修饰词按固定顺序）；非法输入返回空串。 */
export function normalizeChord(text: string): string {
  const spec = parseChord(text)
  return spec === null ? '' : canonicalChordText(spec)
}

function canonicalChordText(spec: ChordSpec): string {
  const parts: string[] = []
  for (const modifier of MODIFIER_ORDER) {
    if (spec[modifier]) parts.push(modifier)
  }
  parts.push(spec.key)
  return parts.join('+')
}

/** 把 `Mod` 按平台展开成 `ctrl` 或 `meta`；用于物理按键比较。 */
export function resolveModChord(spec: ChordSpec, platform: ChordPlatform): ChordSpec {
  if (!spec.mod) return spec
  return {
    mod: false,
    ctrl: spec.ctrl || platform !== 'darwin',
    meta: spec.meta || platform === 'darwin',
    alt: spec.alt,
    shift: spec.shift,
    key: spec.key,
  }
}

/** 平台相关的物理 chord 签名；`Mod+S` 与 win32 上的 `Ctrl+S` 得到同一签名。 */
export function chordSignature(spec: ChordSpec, platform: ChordPlatform): string {
  return canonicalChordText(resolveModChord(spec, platform))
}

/** 展示用主键。 */
function formatKey(key: string): string {
  const mapped = KEY_DISPLAY[key]
  if (mapped !== undefined) return mapped
  if (key.length === 1) return key.toUpperCase()
  if (key.length === 2 && key.startsWith('f') && key[1] >= '0' && key[1] <= '9') {
    return key.toUpperCase()
  }
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/** 生成展示文本；`Mod` 按平台展开。 */
export function formatChord(spec: ChordSpec, platform: ChordPlatform = 'win32'): string {
  const parts: string[] = []
  const push = (value: string): void => {
    if (!parts.includes(value)) parts.push(value)
  }
  if (spec.mod) push(platform === 'darwin' ? 'Cmd' : 'Ctrl')
  if (spec.ctrl) push('Ctrl')
  if (spec.alt) push('Alt')
  if (spec.shift) push('Shift')
  if (spec.meta) push('Cmd')
  parts.push(formatKey(spec.key))
  return parts.join('+')
}

/**
 * 事件是否命中 chord。
 *
 * `Mod` 在这里按“Ctrl 或 Cmd”匹配；需要区分平台时先 `resolveModChord`。
 * 未声明的修饰键必须处于松开状态，避免 `S` 误命中 `Ctrl+S`。
 */
export function matchChord(event: KeyEventLike, chord: ChordSpec): boolean {
  if (event === null || typeof event !== 'object') return false
  if (typeof event.key !== 'string') return false
  if (normalizeKeyToken(event.key) !== chord.key) return false

  const ctrl = event.ctrlKey === true
  const meta = event.metaKey === true
  const alt = event.altKey === true
  const shift = event.shiftKey === true

  if (chord.mod && !ctrl && !meta) return false
  if (!chord.mod) {
    if (ctrl !== chord.ctrl) return false
    if (meta !== chord.meta) return false
  }
  if (alt !== chord.alt) return false
  if (shift !== chord.shift) return false
  return true
}
