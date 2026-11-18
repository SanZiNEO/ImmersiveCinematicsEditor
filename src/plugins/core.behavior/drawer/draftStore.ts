/**
 * 记录级草稿状态机（11-01 §五：同一时间只有一份草稿）。
 *
 * 口径：
 * - 现有记录：进入详情时深拷贝记录体作为草稿，本地改动只落草稿；「应用」产生一条（或一次
 *   批量）命令，一次撤销回整条；「放弃」丢弃草稿，文档不动。
 * - 新增记录：先建本地草稿，取消不留空对象；应用时才走 `rule.add` / `binding.add`。
 * - 切换到另一记录时若草稿未应用：外壳向作者询问「应用 / 放弃 / 取消」；本模块只给出
 *   冲突双方，不替作者做选择。
 *
 * 本文件不 import Vue / 命令层，纯数据转移，自检脚本可直接跑。
 */
import type { JsonObject } from '../../../core/doc/types.ts'
import { cloneJson } from '../../../core/doc/json.ts'
import type { RecordRef } from '../../../features/behavior/shared.ts'
import { sameRecordRef } from '../../../features/behavior/shared.ts'

/** 一份未应用的记录草稿。 */
export interface RecordDraft {
  ref: RecordRef
  /** 新增记录（尚未写进文档）。 */
  isNew: boolean
  /** 草稿体：规则 = `{ id, condition, actions, policy }`；绑定 = `{ id, rule, clip, gate, control, schedule, exit }`。 */
  body: JsonObject
  /** 草稿期是否被改动过（决定切换记录时是否需要询问）。 */
  dirty: boolean
}

/** 开启草稿的结果：无在途草稿直接打开；有在途草稿且身份不同 → 冲突，旧草稿挂起待作者处置。 */
export type BeginDraftOutcome =
  | { kind: 'open'; draft: RecordDraft }
  | { kind: 'conflict'; active: RecordDraft; pending: PendingDraft }

/** 被挂起的待开草稿（作者选择「应用旧 / 放弃旧」之后再打开）。 */
export interface PendingDraft {
  ref: RecordRef
  body: JsonObject
  isNew: boolean
}

/**
 * 尝试开启一份草稿。
 * - 当前无草稿 → 直接 `open`；
 * - 当前草稿就是同一记录 → 不重置草稿（原地继续编辑）；
 * - 当前草稿是另一记录且有改动 → `conflict`，返回在途草稿与待开草稿；
 * - 当前草稿是另一记录且未改动 → 直接吞掉旧草稿并 `open`。
 */
export function beginDraft(
  current: RecordDraft | null,
  ref: RecordRef,
  body: JsonObject,
  isNew: boolean,
): BeginDraftOutcome {
  if (current === null) {
    return { kind: 'open', draft: { ref, body, isNew, dirty: false } }
  }
  if (sameRecordRef(current.ref, ref)) {
    return { kind: 'open', draft: current }
  }
  if (!current.dirty) {
    return { kind: 'open', draft: { ref, body, isNew, dirty: false } }
  }
  return {
    kind: 'conflict',
    active: current,
    pending: { ref, body: cloneJson(body), isNew },
  }
}

/** 把待开草稿落成新的在途草稿（作者处置完旧草稿后调用）。 */
export function openPending(pending: PendingDraft): RecordDraft {
  return { ref: pending.ref, body: pending.body, isNew: pending.isNew, dirty: false }
}

/** 标记草稿已改动（本地编辑时调用）。 */
export function markDirty(draft: RecordDraft): void {
  draft.dirty = true
}

/** 深拷贝一份记录体作为草稿初始值。 */
export function cloneBody(body: JsonObject): JsonObject {
  return cloneJson(body)
}

/** 是否为同一记录的在途草稿。 */
export function draftMatches(draft: RecordDraft | null, ref: RecordRef): boolean {
  return draft !== null && sameRecordRef(draft.ref, ref)
}
