/**
 * 镜头检查面板的会话状态（08-05 §3.1 / §4.3）。
 *
 * 只存界面状态：当前 tab、预览原点、被定位的片段。会话级、进程内，不写盘、不进撤销栈。
 * 键含 `docKey` 与 `trackId`，换文档或换轨道都不会串用上一份的预览原点。
 */
import { reactive } from 'vue'

/** 四个 tab。 */
export const INSPECT_TABS = ['lane', 'continuity', 'player', 'playback'] as const
export type InspectTab = (typeof INSPECT_TABS)[number]

/** tab 标签。 */
export const INSPECT_TAB_LABELS: Readonly<Record<InspectTab, string>> = {
  lane: 'Lane',
  continuity: '连续性',
  player: '玩家移动',
  playback: '回放',
}

/** 会话状态。 */
interface InspectSessionState {
  tab: InspectTab
  /** 预览原点：`docKey#trackId` → 世界坐标。 */
  origins: Record<string, { x: number; z: number }>
  /** 最近一次"定位片段"的目标。 */
  focusedClipKey: string | null
}

/** 单例会话状态（面板重开、切页后恢复）。 */
export const inspectSession = reactive<InspectSessionState>({
  tab: 'lane',
  origins: {},
  focusedClipKey: null,
})

/** 切换 tab。 */
export function setInspectTab(tab: InspectTab): void {
  inspectSession.tab = tab
}

/** 预览原点键。 */
export function originKey(docKey: string, trackId: string): string {
  return `${docKey}#${trackId}`
}

/** 读预览原点（没有返回 `null`）。 */
export function readOrigin(docKey: string, trackId: string): { x: number; z: number } | null {
  return inspectSession.origins[originKey(docKey, trackId)] ?? null
}

/** 写预览原点。 */
export function writeOrigin(docKey: string, trackId: string, point: { x: number; z: number }): void {
  inspectSession.origins[originKey(docKey, trackId)] = { x: point.x, z: point.z }
}

/** 定位片段（只记目标，不改选区）。 */
export function focusClip(clipKey: string | null): void {
  inspectSession.focusedClipKey = clipKey
}
