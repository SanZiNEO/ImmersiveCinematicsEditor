/**
 * 分隔线缩放（04-03）。
 *
 * 纯函数：比例数组进、比例数组出；只重分配相邻两项，遵守像素下限，总和保持 1。
 * 真实 DOM 测量与提交由 `ResizeHandle.vue` 负责。
 */

/** 键盘单步：8px；Shift 加速到 24px。 */
export const RESIZE_STEP_PX = 8
export const RESIZE_STEP_SHIFT_PX = 24

/** 未提供总像素时的比例换算基准（调用方应传真实像素）。 */
const DEFAULT_TOTAL_PIXELS = 1000

/** 键盘调整方向。 */
export type ResizeKey = 'left' | 'right' | 'up' | 'down'

/** 浮点误差阈值。 */
const EPSILON = 1e-9

/**
 * 把相邻两项重新分配 `deltaRatio`。
 *
 * - `index` 是分隔线左侧/上侧的子项；右侧/下侧是 `index + 1`。
 * - `deltaRatio > 0` 让 `index` 变大、`index + 1` 变小。
 * - `minPixels` 与 `currentSizes` 对齐；`totalPixels` 是该 split 方向的总像素。
 * - 返回数组总和为 1；约束冲突时保持原比例（不制造负值），由布局服务做最终校验。
 */
export function resizeRatio(
  currentSizes: readonly number[],
  index: number,
  deltaRatio: number,
  minPixels: readonly number[] | undefined,
  totalPixels: number,
): number[] {
  const sizes = normalizeSizes(currentSizes)
  if (sizes.length < 2) return sizes
  if (!Number.isInteger(index) || index < 0 || index >= sizes.length - 1) return sizes

  const pairSum = sizes[index] + sizes[index + 1]
  const minA = minimumRatio(minPixels, index, totalPixels)
  const minB = minimumRatio(minPixels, index + 1, totalPixels)

  let lower = minA
  let upper = pairSum - minB
  if (upper < lower) {
    // 两个下限之和超过可分配空间：保持当前值，交给布局服务重新夹取。
    lower = Math.min(sizes[index], pairSum)
    upper = lower
  }

  const wanted = sizes[index] + finiteDelta(deltaRatio, pairSum)
  const nextA = clamp(wanted, lower, upper)
  const nextB = pairSum - nextA

  const result = sizes.slice()
  result[index] = nextA
  result[index + 1] = nextB
  return fixSum(result)
}

/**
 * 键盘方向键换算成比例后调用 `resizeRatio`。
 *
 * - `left` / `up` 让 `index` 变小；`right` / `down` 让它变大。
 * - `shift` 时步长 24px，否则 8px。
 * - `Home` / `End` 不在这里：调用方给最小/最大比例（用 `resizeRatio` 的像素下限）。
 */
export function keyboardResize(
  currentSizes: readonly number[],
  index: number,
  key: ResizeKey,
  shift: boolean,
  totalPixels: number = DEFAULT_TOTAL_PIXELS,
): number[] {
  const total =
    Number.isFinite(totalPixels) && totalPixels > 0 ? totalPixels : DEFAULT_TOTAL_PIXELS
  const step = shift ? RESIZE_STEP_SHIFT_PX : RESIZE_STEP_PX
  const sign = key === 'left' || key === 'up' ? -1 : 1
  return resizeRatio(currentSizes, index, (sign * step) / total, undefined, total)
}

/** 把任意比例数组归一化为有限正数、总和 1。 */
export function normalizeSizes(currentSizes: readonly number[]): number[] {
  const values = currentSizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0))
  const total = values.reduce((sum, size) => sum + size, 0)
  if (!Number.isFinite(total) || total <= 0) {
    const count = Math.max(1, values.length)
    return values.map(() => 1 / count)
  }
  return values.map((size) => size / total)
}

function minimumRatio(
  minPixels: readonly number[] | undefined,
  index: number,
  totalPixels: number,
): number {
  const pixels = minPixels?.[index]
  if (pixels === undefined || !Number.isFinite(pixels) || pixels <= 0) return 0
  if (!Number.isFinite(totalPixels) || totalPixels <= 0) return 0
  return Math.min(1, pixels / totalPixels)
}

function finiteDelta(deltaRatio: number, pairSum: number): number {
  if (Number.isFinite(deltaRatio)) return deltaRatio
  if (deltaRatio === Number.POSITIVE_INFINITY) return pairSum
  if (deltaRatio === Number.NEGATIVE_INFINITY) return -pairSum
  return 0
}

function clamp(value: number, lower: number, upper: number): number {
  if (!Number.isFinite(value)) return lower
  if (value < lower) return lower
  if (value > upper) return upper
  return value
}

function fixSum(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  if (!Number.isFinite(total) || total <= 0) {
    return sizes.map(() => 1 / Math.max(1, sizes.length))
  }
  const diff = 1 - total
  if (Math.abs(diff) <= EPSILON) return sizes
  const last = sizes.length - 1
  if (sizes[last] + diff >= 0) {
    sizes[last] += diff
    return sizes
  }
  return sizes.map((size) => size / total)
}
