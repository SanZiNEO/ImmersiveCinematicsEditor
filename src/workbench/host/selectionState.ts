/**
 * 选区四态解析（04-05）。
 *
 * 唯一事实来源是 03 的会话选区与批选；本模块只做纯判定，不缓存、不修复、
 * 不产生第二份 Selection。宿主和面板都调用同一个函数，避免两处规则漂移。
 */
import type { Selection } from '../../core/doc/types.ts'
import type { ClipSelectionState } from '../api/context.ts'

/** 判定输入。 */
export interface ClipSelectionInput {
  /** 03 会话主选区。 */
  selection: Selection
  /** 03 会话批选（`SessionState.clipKeys`）。 */
  clipKeys: readonly string[]
  /** 03 的失效记录（`SessionState.selectionInvalid`）。 */
  invalid: { reason: string; previous: Selection } | null
  /** 片段键是否仍存在于当前文档结构里。 */
  clipExists: (key: string) => boolean
}

/** 该选择是否带一个仍存活的片段键。 */
function liveClipKey(selection: Selection, clipExists: (key: string) => boolean): string | null {
  const key = selection.clipKey
  if (key === undefined) {
    return null
  }
  return clipExists(key) ? key : null
}

/**
 * 解析成 `none | multi | clip | invalid | foreign` 五分支（`foreign` 是四态之外的
 * 显式域，供属性面板显示“当前选择不属于片段属性”）。
 *
 * 优先级固定：失效记录 → 非片段域 → 批选 → 单片段 → 空。
 */
export function resolveClipSelectionState(input: ClipSelectionInput): ClipSelectionState {
  const { selection, clipKeys, invalid, clipExists } = input

  if (invalid !== null) {
    const previousKey = invalid.previous.clipKey
    const stillExists = previousKey !== undefined && clipExists(previousKey)
    if (!stillExists) {
      return { kind: 'invalid', reason: invalid.reason, previous: invalid.previous }
    }
  }

  const domain = selection.domain
  if (domain === 'path' || domain === 'rule' || domain === 'binding') {
    return { kind: 'foreign', domain, selection }
  }

  if (clipKeys.length > 1) {
    return { kind: 'multi', clipKeys: [...clipKeys] }
  }

  if (domain === 'clip' || domain === 'object' || domain === 'keyframe') {
    const key = liveClipKey(selection, clipExists)
    if (key !== null) {
      return { kind: 'clip', clipKey: key, selection }
    }
  }

  return { kind: 'none' }
}
