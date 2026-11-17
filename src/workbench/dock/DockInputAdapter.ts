/**
 * 输入抽象（04-03）。
 *
 * 同一指针事件只能命中一个手势；优先级来自 04-03「手势优先级」，从高到低：
 * input → scrollbar → timeline → effect → flight → panel → none。
 * 纯函数，不读 DOM；调用方把命中元素抽象成 `HitTestNode`。
 */

/** 拖动起点类别。 */
export type DragSource =
  | 'panel'
  | 'timeline'
  | 'effect'
  | 'input'
  | 'scrollbar'
  | 'flight'
  | 'none'

/** 命中元素的最小抽象。 */
export interface HitTestNode {
  role?: string
  tagName?: string
  contentEditable?: boolean
  isScrollbar?: boolean
  isTimeline?: boolean
  isEffect?: boolean
  isFlight?: boolean
  isPanelTitle?: boolean
}

const INPUT_TAGS: Record<string, true> = {
  INPUT: true,
  TEXTAREA: true,
  SELECT: true,
}

/** 文本/值输入类 role（含下拉、数值、颜色、开关、复选）。 */
const INPUT_ROLES: Record<string, true> = {
  textbox: true,
  searchbox: true,
  combobox: true,
  spinbutton: true,
  slider: true,
  switch: true,
  checkbox: true,
  radio: true,
  listbox: true,
  option: true,
  menuitemcheckbox: true,
  menuitemradio: true,
}

/** 是否属于第一优先级：文本输入 / IME / 值输入。 */
export function isTextInputNode(node: HitTestNode): boolean {
  if (node.contentEditable) return true
  const tag = node.tagName?.toUpperCase()
  if (tag !== undefined && INPUT_TAGS[tag] === true) return true
  const role = node.role?.toLowerCase()
  if (role !== undefined && INPUT_ROLES[role] === true) return true
  return false
}

/**
 * 命中拖动起点。按固定优先级返回，第一个命中的类别胜出。
 * 不能用“最后点过哪里”推断。
 */
export function hitTestDragSource(node: HitTestNode): DragSource {
  if (isTextInputNode(node)) return 'input'
  if (node.isScrollbar) return 'scrollbar'
  if (node.isTimeline) return 'timeline'
  if (node.isEffect) return 'effect'
  if (node.isFlight) return 'flight'
  const role = node.role?.toLowerCase()
  if (node.isPanelTitle || role === 'tab') return 'panel'
  return 'none'
}

/** 只有面板标题/标签可以作为面板拖动起点。 */
export function isPanelDragSource(source: DragSource): boolean {
  return source === 'panel'
}
