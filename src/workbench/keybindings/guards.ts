/**
 * 快捷键守卫（04-10）：输入法、输入框白名单、可编辑元素判定。
 *
 * 纯逻辑：参数可以是 `KeyboardEvent` / `HTMLElement`，也可以是测试里的有限形状对象。
 */
import type { ChordPlatform } from './chord.ts'
import { chordSignature, parseChord } from './chord.ts'

/** 输入框 / 文本域 / contenteditable 内仍允许触发的 chord。 */
export const KEY_WHITELIST_IN_EDITABLE = ['Mod+S', 'Esc'] as const

/** 可编辑元素的最小形状。 */
export interface EditableLike {
  tagName?: string
  isContentEditable?: boolean
  contentEditable?: boolean | string
  getAttribute?: (name: string) => string | null
}

/** 输入法组合态可读取的最小事件形状。 */
export interface ImeEventLike {
  isComposing?: boolean
  keyCode?: number
  key?: string
}

/** 是否是可编辑元素（input / textarea / contenteditable）。 */
export function isEditableElement(element: EditableLike | null | undefined): boolean {
  if (element === null || element === undefined) return false

  if (element.isContentEditable === true) return true

  const tagName = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : ''
  if (tagName === 'input' || tagName === 'textarea') return true

  const contentEditable = element.contentEditable
  if (contentEditable === true) return true
  if (typeof contentEditable === 'string') {
    const normalized = contentEditable.toLowerCase()
    if (normalized === 'true' || normalized === 'plaintext-only') return true
  }

  if (typeof element.getAttribute === 'function') {
    try {
      const attribute = element.getAttribute('contenteditable')
      if (attribute !== null && attribute !== undefined) {
        const normalized = attribute.toLowerCase()
        if (normalized === '' || normalized === 'true' || normalized === 'plaintext-only') return true
      }
    } catch {
      return false
    }
  }

  return false
}

/** 是否处于输入法组合中；`keyCode===229` 是 IME 的兜底信号。 */
export function isImeComposing(event: ImeEventLike | null | undefined): boolean {
  if (event === null || event === undefined) return false
  if (event.isComposing === true) return true
  if (event.keyCode === 229) return true
  return event.key === 'Process'
}

const WHITELIST_SIGNATURES: ReadonlyArray<{ win32: string; darwin: string; linux: string }> =
  KEY_WHITELIST_IN_EDITABLE.map((text) => {
    const spec = parseChord(text)
    // 常量表在模块加载期即可判定；解析失败说明表本身坏了，直接抛错。
    if (spec === null) throw new Error(`输入框白名单 chord 无法解析：${text}`)
    return {
      win32: chordSignature(spec, 'win32'),
      darwin: chordSignature(spec, 'darwin'),
      linux: chordSignature(spec, 'linux'),
    }
  })

/** chord 是否在输入框白名单内；按平台把 `Mod` 展开后再比较。 */
export function isChordWhitelistedInEditable(
  text: string,
  platform: ChordPlatform = 'win32',
): boolean {
  const spec = parseChord(text)
  if (spec === null) return false
  const signature = chordSignature(spec, platform)
  return WHITELIST_SIGNATURES.some((entry) => entry[platform] === signature)
}
