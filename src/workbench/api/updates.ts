/**
 * 更新状态契约（03-03 冻结）。
 *
 * 这是 03 / 04 / 05 轮次共用的唯一契约：
 * - 只能追加可选字段（`?:`）；
 * - 不得修改 `status` 字面量（`up-to-date` / `downloading` 等一下游按字面量判定）；
 * - 不得把必填字段降级为可选（`downloading.percent` 等界面直接读取）。
 */

/** 更新状态八态。 */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; checkedAt: string }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; reason: string; code?: string }
  | { status: 'unavailable' }

/** electron-updater 原生事件 → UpdateState 状态映射（实现与契约的对齐表）。 */
export const UPDATER_EVENT_MAP = {
  'checking-for-update': 'checking',
  'update-available': 'available',
  'update-not-available': 'up-to-date',
  'download-progress': 'downloading',
  'update-downloaded': 'downloaded',
  error: 'error',
} as const
