/**
 * 选区只读端口（04-05）。
 *
 * 04 不建第二份选区：唯一来源是 03 的 `DocStore.session`（主选区 + 批选）。
 */
import type { Selection } from '../../core/doc/types.ts'
import type { ClipSelectionState, EffectTarget } from './context.ts'
import type { SelectionSnapshot } from './documents.ts'

/** 选区服务：面板与宿主共用的只读视图。 */
export interface SelectionServicePort {
  snapshot(): SelectionSnapshot
  /** 四态判定结果（含 path/rule/binding 的 `foreign`）。 */
  state(): ClipSelectionState
  subscribe(listener: (snapshot: SelectionSnapshot) => void): () => void
  /** 宿主转发的定位请求（面板只发意图，真正选区由 03 决定）。 */
  requestSelect(selection: Selection): void
  /** 属性面板 → 效果面板定位（只带目标，不带值）。 */
  requestReveal(target: EffectTarget): void
}
