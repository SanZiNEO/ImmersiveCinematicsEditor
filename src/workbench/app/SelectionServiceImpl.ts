/**
 * 选区服务（04-05）：03 `DocStore.session` 的只读视图 + 四态判定。
 *
 * 04 不建第二份选区；这里只做快照、订阅与「面板发意图 → 03 决定选区」的转发。
 */
import type { DocStore } from '../../core/doc/store.ts'
import type { Selection } from '../../core/doc/types.ts'
import { liveClipKeys } from '../../core/doc/identity.ts'
import type { ClipSelectionState, EffectTarget } from '../api/context.ts'
import type { SelectionSnapshot } from '../api/documents.ts'
import type { SelectionServicePort } from '../api/selection.ts'
import { resolveClipSelectionState } from '../host/selectionState.ts'

/** 选区服务实现。 */
export class SelectionServiceImpl implements SelectionServicePort {
  private readonly store: DocStore
  private readonly listeners = new Set<(snapshot: SelectionSnapshot) => void>()
  private readonly reveals = new Set<(target: EffectTarget) => void>()
  private unsubscribe: (() => void) | null = null

  constructor(store: DocStore) {
    this.store = store
    this.unsubscribe = store.subscribe(() => {
      this.emit()
    })
  }

  snapshot(): SelectionSnapshot {
    return {
      selection: this.store.session.selection,
      clipKeys: [...this.store.session.clipKeys],
      revision: this.store.revision,
    }
  }

  state(): ClipSelectionState {
    const doc = this.store.doc
    const selection = this.store.session.selection
    const live = doc === null ? new Set<string>() : new Set(liveClipKeys(doc, this.store.registry))
    return resolveClipSelectionState({
      selection,
      clipKeys: this.store.session.clipKeys,
      invalid: this.store.session.selectionInvalid,
      clipExists: (key) => live.has(key),
    })
  }

  subscribe(listener: (snapshot: SelectionSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  requestSelect(selection: Selection): void {
    this.store.select(selection)
    this.emit()
  }

  requestReveal(target: EffectTarget): void {
    for (const listener of this.reveals) {
      listener(target)
    }
  }

  /** 订阅定位请求（效果面板用）。 */
  onReveal(listener: (target: EffectTarget) => void): () => void {
    this.reveals.add(listener)
    return () => {
      this.reveals.delete(listener)
    }
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.listeners.clear()
    this.reveals.clear()
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

