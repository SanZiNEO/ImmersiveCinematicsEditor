/**
 * 抽屉布局纯逻辑（04-06）。
 *
 * 高度只在这里算，真实高度仍归 04-02 的布局树；组件把结果写回 `setGroupState`，
 * 不持第二份高度状态，也不写 localStorage。
 */

/** 抽屉默认打开高度（px）。 */
export const DRAWER_DEFAULT_HEIGHT = 280

/** 抽屉常规高度下限（px）。 */
export const DRAWER_MIN_HEIGHT = 200

/** 抽屉常规高度上限（px）。 */
export const DRAWER_MAX_HEIGHT = 420

/** 低窗阈值：低于它打开抽屉会压主轴。 */
export const DRAWER_LOW_WINDOW_HEIGHT = 720

/** 极低窗阈值：低于它抽屉上限降到 200。 */
export const DRAWER_TIGHT_WINDOW_HEIGHT = 600

/** 低窗时主轴最小高度（px）。 */
export const DRAWER_AXIS_MIN_HEIGHT = 160

/** 极低窗时主轴最小高度（px）。 */
export const DRAWER_AXIS_MIN_HEIGHT_TIGHT = 120

/** 低窗提示（文字，不依赖颜色）。 */
export const DRAWER_LOW_WINDOW_NOTICE =
  '窗口较矮：抽屉打开时主轴至少保留 160px，抽屉与主轴二选一。'

/** 极低窗提示。 */
export const DRAWER_TIGHT_WINDOW_NOTICE =
  '窗口过矮：抽屉最高 200px，主轴至少保留 120px。'

/** 抽屉高度夹取结果。 */
export interface DrawerHeightResult {
  /** 抽屉实际可用高度（px）。 */
  height: number
  /** 主轴最小高度（px）；由 `squeezeAxis` 应用。 */
  axisHeight: number
  /** 低窗提示；正常窗口为 `null`。 */
  notice: string | null
}

/** 夹取选项（测试与特殊页面可覆盖默认档位）。 */
export interface ClampDrawerOptions {
  minHeight?: number
  maxHeight?: number
  /** 覆盖 `<720` 阈值。 */
  lowWindowHeight?: number
  /** 覆盖 `<600` 阈值。 */
  tightWindowHeight?: number
}

/** 窗口是否属于低窗（抽屉打开会压主轴）。 */
export function isLowWindow(viewportHeight: number): boolean {
  return Number.isFinite(viewportHeight) && viewportHeight < DRAWER_LOW_WINDOW_HEIGHT
}

/** 窗口是否属于极低窗（抽屉上限降到 200）。 */
export function isTightWindow(viewportHeight: number): boolean {
  return Number.isFinite(viewportHeight) && viewportHeight < DRAWER_TIGHT_WINDOW_HEIGHT
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/**
 * 把请求高度夹到当前窗口允许的范围。
 *
 * - 默认 200–420；
 * - `<720`：上限仍 420，但主轴最小 160，并给出提示；
 * - `<600`：上限 200，主轴最小 120；
 * - 抽屉高度不会挤掉主轴最小高度；窗口小到放不下时优先保主轴。
 */
export function clampDrawerHeight(
  requested: number,
  viewportHeight: number,
  opts: ClampDrawerOptions = {},
): DrawerHeightResult {
  const low = finiteOr(opts.lowWindowHeight ?? DRAWER_LOW_WINDOW_HEIGHT, DRAWER_LOW_WINDOW_HEIGHT)
  const tight = finiteOr(opts.tightWindowHeight ?? DRAWER_TIGHT_WINDOW_HEIGHT, DRAWER_TIGHT_WINDOW_HEIGHT)

  const height = Math.max(0, finiteOr(viewportHeight, 0))
  const isTight = height < tight
  const isLow = height < low && !isTight

  const baseMax = finiteOr(opts.maxHeight ?? DRAWER_MAX_HEIGHT, DRAWER_MAX_HEIGHT)
  const max = Math.max(1, isTight ? Math.min(baseMax, DRAWER_MIN_HEIGHT) : baseMax)
  const min = Math.min(Math.max(1, finiteOr(opts.minHeight ?? DRAWER_MIN_HEIGHT, DRAWER_MIN_HEIGHT)), max)
  const axisHeight = isTight ? DRAWER_AXIS_MIN_HEIGHT_TIGHT : DRAWER_AXIS_MIN_HEIGHT

  const usable = Math.max(1, height - axisHeight)
  const wanted = Math.min(max, Math.max(min, finiteOr(requested, DRAWER_DEFAULT_HEIGHT)))
  const clamped = Math.min(wanted, usable)

  return {
    height: Math.max(1, Math.round(clamped)),
    axisHeight,
    notice: isTight ? DRAWER_TIGHT_WINDOW_NOTICE : isLow ? DRAWER_LOW_WINDOW_NOTICE : null,
  }
}

/** 抽屉标签的最小形态（排序用）。 */
export interface DrawerTabLike {
  tabId: string
  order: number
}

/**
 * 按贡献 `order` 排序；同 order 按 tabId 稳定排序（不依赖注册顺序）。
 *
 * 布局树里的标签顺序优先由 04-02 负责；这里只用于首次渲染与注册表快照。
 */
export function orderDrawerTabs<T extends DrawerTabLike>(tabs: readonly T[]): T[] {
  return [...tabs].sort((left, right) => {
    const byOrder = left.order - right.order
    return byOrder !== 0 ? byOrder : left.tabId.localeCompare(right.tabId)
  })
}

/** 根据布局状态与当前活动 tab 判断下一次点击的语义。 */
export type DrawerTabToggle = 'open' | 'activate' | 'collapse'

/**
 * 点击标签的语义：
 * - 抽屉不可见 / 折叠 → 打开该 tab；
 * - 抽屉可见且点的不是当前 tab → 切换；
 * - 抽屉可见且点的是当前 tab → 折叠整个抽屉。
 */
export function drawerTabToggle(state: {
  visible: boolean
  collapsed: boolean
  activeTabId?: string
}, tabId: string): DrawerTabToggle {
  if (!state.visible || state.collapsed) {
    return 'open'
  }
  return state.activeTabId === tabId ? 'collapse' : 'activate'
}
