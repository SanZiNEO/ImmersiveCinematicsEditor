/**
 * 时间轴交互状态（06-12 拆分：只承担"交互"这一类状态）。
 *
 * 从 `core.timeline/state.ts` 抽出：选择工具 / 刀片工具、吸附开关、活动轨道、会话剪贴板。
 * 这些状态属于会话，不进文档、不进撤销。
 *
 * 变化理由：作者的操作模式与临时选择变化。文档内容变化不会改这里。
 */
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import type { JsonObject } from '../../core/doc/types.ts'

/** 工具：选择 / 刀片（05-10 工具栏）。 */
export type TimelineTool = 'select' | 'blade'

/** 会话剪贴板条目（含轨道类型；不含 clipKey，粘贴时重新生成）。 */
export interface TimelineClipboardEntry {
  trackType: string
  start: number
  duration: number
  loop: boolean
  loopCount?: number
  label: string
  objects: JsonObject
}

/** 时间轴交互状态。 */
export class TimelineInteractionState {
  /** 选择工具 / 刀片工具。 */
  readonly tool: Ref<TimelineTool> = ref('select')
  /** 吸附开关（会话级）。 */
  readonly snapEnabled: Ref<boolean> = ref(true)
  /** 当前活动轨道（工具栏「新建片段」的目标）。 */
  readonly activeTrackId: Ref<string | null> = ref(null)
  /** 会话剪贴板（不写系统剪贴板、不写文件）。 */
  readonly clipboard: ShallowRef<readonly TimelineClipboardEntry[]> = shallowRef([])

  setTool(tool: TimelineTool): void {
    this.tool.value = tool
  }

  toggleBlade(): void {
    this.tool.value = this.tool.value === 'blade' ? 'select' : 'blade'
  }

  toggleSnap(): void {
    this.snapEnabled.value = !this.snapEnabled.value
  }

  setActiveTrack(trackId: string): void {
    this.activeTrackId.value = trackId
  }

  setClipboard(entries: readonly TimelineClipboardEntry[]): void {
    this.clipboard.value = entries
  }

  clearClipboard(): void {
    this.clipboard.value = []
  }
}
