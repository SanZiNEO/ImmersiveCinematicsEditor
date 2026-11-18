/**
 * LETTERBOX 画幅层纯逻辑（09-06）。
 *
 * 事实基准：
 * - `overlay/LetterboxLayer.java`：固定 z=0；`aspect_ratio<=0` 不绘制；
 *   更宽 → 上下黑边，更窄 → 左右黑边（pillarbox），同比例无黑边；
 *   空档（无活跃片段）aspect=0 + opacity=1 复位；渐出 0.5s。
 * - 目录 `TrackSchemas.letterboxObjects()` 只有 `aspect_ratio`（min 0，缺省 2.35）与 `opacity`（0..1）。
 *
 * 画幅没有方向 / 裁切 / 素材字段：多画幅轨 = 多个黑边层叠加。
 */
import type { JsonObject } from '../../core/doc/types.ts'
import { explicitValue, LETTERBOX_FIELD_PATHS } from './layers.ts'
import { letterboxBars } from './geometry.ts'
import type { LetterboxBars } from './geometry.ts'

/** 画幅缺省比例（与目录缺省一致）。 */
export const LETTERBOX_DEFAULT_ASPECT = 2.35

/** 画幅渐出时长（`LetterboxLayer.FADE_OUT_SECONDS`）。 */
export const LETTERBOX_FADE_OUT_SECONDS = 0.5

/** 画幅空档复位值：aspect=0 + opacity=1。 */
export const LETTERBOX_IDLE_ASPECT = 0
export const LETTERBOX_IDLE_OPACITY = 1

/** 读 `aspect_ratio`（缺失 / 非数字 → 2.35）。 */
export function letterboxAspectOf(objects: JsonObject): number {
  const explicit = explicitValue(objects, 'aspect_ratio')
  if (explicit.present && typeof explicit.value === 'number' && Number.isFinite(explicit.value)) {
    return explicit.value
  }
  return LETTERBOX_DEFAULT_ASPECT
}

/** 读 `opacity`（缺失 / 非数字 → 1）。 */
export function letterboxOpacityOf(objects: JsonObject): number {
  const explicit = explicitValue(objects, 'opacity')
  if (explicit.present && typeof explicit.value === 'number' && Number.isFinite(explicit.value)) {
    return explicit.value
  }
  return 1
}

/** 黑边方向文案。 */
export type LetterboxOrientation = 'none' | 'horizontal' | 'vertical' | 'invisible'

/** 画幅预览：几何 + 方向 + 是否绘制。 */
export interface LetterboxPreview extends Omit<LetterboxBars, 'orientation'> {
  aspect: number
  orientation: LetterboxOrientation
  visible: boolean
  note: string
}

/** 生成画幅预览（`screenWidth/screenHeight` 是画幅比例，不是像素）。 */
export function letterboxPreview(
  objects: JsonObject,
  screenWidth = 16,
  screenHeight = 9,
): LetterboxPreview {
  const aspect = letterboxAspectOf(objects)
  const opacity = letterboxOpacityOf(objects)
  const bars = letterboxBars(aspect, screenWidth, screenHeight)
  const visible = aspect > 0 && opacity > 0.001
  let orientation: LetterboxOrientation = 'none'
  if (!visible) {
    orientation = 'invisible'
  } else if (bars.orientation === 'horizontal') {
    orientation = 'horizontal'
  } else if (bars.orientation === 'vertical') {
    orientation = 'vertical'
  }
  const note = !visible
    ? `aspect_ratio=${aspect} / opacity=${opacity}：不绘制黑边`
    : bars.orientation === 'horizontal'
      ? `更宽画幅：上下黑边（顶 ${(bars.top * 100).toFixed(1)}% / 底 ${(bars.bottom * 100).toFixed(1)}%）`
      : bars.orientation === 'vertical'
        ? `更窄画幅：左右黑边（左 ${(bars.left * 100).toFixed(1)}% / 右 ${(bars.right * 100).toFixed(1)}%）`
        : '与屏幕同比例：无黑边'
  return { ...bars, aspect, orientation, visible, note }
}

/** 常用画幅比例（09-06 的预设按钮）。 */
export const LETTERBOX_ASPECT_OPTIONS = [
  { label: '2.35:1', value: 2.35 },
  { label: '2.00:1', value: 2 },
  { label: '1.85:1', value: 1.85 },
  { label: '16:9', value: 16 / 9 },
  { label: '4:3', value: 4 / 3 },
  { label: '1:1', value: 1 },
  { label: '9:16', value: 9 / 16 },
] as const

/** 画幅比输入校验：非负有限数；0 合法（复位值）。 */
export function validateAspectInput(input: string): { ok: boolean; value: number; message?: string } {
  const text = input.trim()
  const value = Number(text)
  if (text === '' || !Number.isFinite(value)) {
    return { ok: false, value: 0, message: '画幅比需要有限数字（例如 2.35）' }
  }
  if (value < 0) {
    return { ok: false, value, message: '画幅比不能为负；0 表示不绘制黑边' }
  }
  return { ok: true, value }
}

/** 不属于 LETTERBOX 字段面的键（保留为未知扩展键；运行时不读取）。 */
export function findLetterboxExtraPaths(objects: JsonObject): string[] {
  return Object.keys(objects)
    .filter((path) => !(LETTERBOX_FIELD_PATHS as readonly string[]).includes(path))
    .sort()
}

/** 画幅层说明（面板常驻）。 */
export const LETTERBOX_FIELD_NOTE =
  '画幅层固定 z=0，只有 aspect_ratio 与 opacity；没有方向、裁切、素材字段。多条画幅轨同时活跃时黑边会叠加。'
