/**
 * 时间轴会话视图状态（06-12 拆分：只承担"视图与布局"这一类状态）。
 *
 * 从 `core.timeline/state.ts` 抽出：滚动位置、可视宽度、面板高度、紧凑档判定。
 * 这些状态只影响绘制，不影响文档，也不参与撤销。
 *
 * 变化理由：窗口尺寸与滚动策略变化。文档内容变化不会改这里。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

/** 紧凑档阈值（像素）：低于它切紧凑布局。 */
export const COMPACT_HEIGHT = 240

/** 时间轴视图状态。 */
export class TimelineViewState {
  /** 轨道区横向滚动（像素）；只属于主轴视图。 */
  readonly scrollLeft: Ref<number> = ref(0)
  /** 轨道区可视宽度（像素）。 */
  readonly viewportWidth: Ref<number> = ref(800)
  /** 面板高度（像素）。 */
  readonly panelHeight: Ref<number> = ref(260)

  /** 是否紧凑档。 */
  readonly compact: ComputedRef<boolean> = computed(() => this.panelHeight.value < COMPACT_HEIGHT)

  setScrollLeft(value: number): void {
    if (!Number.isFinite(value)) {
      return
    }
    this.scrollLeft.value = Math.max(0, value)
  }

  setViewportWidth(value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      return
    }
    this.viewportWidth.value = value
  }

  setPanelHeight(value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      return
    }
    this.panelHeight.value = value
  }

  /** 内容宽度：显示范围末端 × 每秒像素 + 尾部留白（05-09）。 */
  contentWidth(end: number, pxPerSecond: number): number {
    const tail = Math.max(120, this.viewportWidth.value * 0.5)
    return Math.max(0, end) * pxPerSecond + tail
  }
}
