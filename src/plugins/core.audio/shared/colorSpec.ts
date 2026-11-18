/**
 * 10 调色规格：CAMERA 57 / ADJUST 59 的窄组、矩阵、色相带、曲线与 LUT/层混合。
 *
 * 事实来源：
 * - `TrackSchemas.CAMERA_COLOR_CHANNELS` / `ADJUST_CHANNELS`（57 / 59，顺序即通道顺序）；
 * - `channelDefault` / `channelMin` / `channelMax`（强度缺省 1、exposure [-5,5]、其余 [-1,1] / [0,1]）；
 * - `ColorAdjustSampler`（LUT 相对资源根、gamma > 0、blend_mode 缺省 normal、blend_amount 缺省 1）；
 * - `MasterColorAdjust` / `AdjustTrackPlayer`（同一实例多轨后发布者覆盖，前者不叠乘）。
 *
 * 本文件不读写文档、不依赖 Vue。
 */
import type { FieldDisplayGroup } from '../../../workbench/api/fieldSurface.ts'

/** 矩阵 3×3 路径（行优先）。 */
export const MATRIX_PATHS = [
  'mix_rr', 'mix_rg', 'mix_rb',
  'mix_gr', 'mix_gg', 'mix_gb',
  'mix_br', 'mix_bg', 'mix_bb',
] as const

/** 色相带：六种基色 × (色相偏移, 饱和度)。 */
export const HUE_BANDS = [
  { name: '红', hue: 'hue_red', sat: 'sat_red' },
  { name: '黄', hue: 'hue_yellow', sat: 'sat_yellow' },
  { name: '绿', hue: 'hue_green', sat: 'sat_green' },
  { name: '青', hue: 'hue_cyan', sat: 'sat_cyan' },
  { name: '蓝', hue: 'hue_blue', sat: 'sat_blue' },
  { name: '品红', hue: 'hue_magenta', sat: 'sat_magenta' },
] as const

/** 10 条调色曲线（顺序 = 旧 clip 级声明顺序；CAMERA 与 ADJUST 各一份）。 */
export const COLOR_CURVES = [
  { key: 'rgb_curve', label: 'RGB 主曲线' },
  { key: 'r_curve', label: 'R 曲线' },
  { key: 'g_curve', label: 'G 曲线' },
  { key: 'b_curve', label: 'B 曲线' },
  { key: 'hv_h_curve', label: '色相-色相' },
  { key: 'hv_s_curve', label: '色相-饱和' },
  { key: 'hv_l_curve', label: '色相-亮度' },
  { key: 'lv_s_curve', label: '亮度-饱和' },
  { key: 'sv_s_curve', label: '饱和-饱和' },
  { key: 'sv_l_curve', label: '饱和-亮度' },
] as const

/** 曲线 → 强度路径（每条曲线各自一个强度；前四条与后六条命名不同）。 */
export function curveStrengthPath(curve: string): string {
  const hit = CURVE_STRENGTHS.find((entry) => entry.curve === curve)
  if (hit !== undefined) return hit.path
  switch (curve) {
    case 'hv_h_curve': return 'hv_h_strength'
    case 'hv_s_curve': return 'hv_s_strength'
    case 'hv_l_curve': return 'hv_l_strength'
    case 'lv_s_curve': return 'lv_s_strength'
    case 'sv_s_curve': return 'sv_s_strength'
    case 'sv_l_curve': return 'sv_l_strength'
    default: return 'curve_strength'
  }
}
/** 强度路径 → 曲线路径（与 `curveStrengthPath` 互逆）。 */
export function curveForStrengthPath(path: string): string | null {
  for (const curve of COLOR_CURVES) {
    if (curveStrengthPath(curve.key) === path) return curve.key
  }
  return null
}

export const CURVE_STRENGTHS = [
  { path: 'curve_strength', curve: 'rgb_curve' },
  { path: 'r_curve_strength', curve: 'r_curve' },
  { path: 'g_curve_strength', curve: 'g_curve' },
  { path: 'b_curve_strength', curve: 'b_curve' },
] as const

/** 14 个显示组（文档 10-04 §4.3 的 12 个通道组 + 曲线定义 + LUT 定义）。 */
export const COLOR_GROUPS: readonly (FieldDisplayGroup & { paths: readonly string[] })[] = [
  {
    key: 'color.basic', label: '基础校色', order: 0,
    paths: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  },
  { key: 'color.hsl', label: 'HSL', order: 1, paths: ['hue', 'saturation', 'vibrance', 'lightness'] },
  { key: 'color.white_balance', label: '白平衡', order: 2, paths: ['temperature', 'tint'] },
  { key: 'color.channels', label: '通道系数', order: 3, paths: ['red', 'green', 'blue'] },
  { key: 'color.matrix', label: '通道混合', order: 4, paths: [...MATRIX_PATHS] },
  {
    key: 'color.curve_strength', label: '曲线强度', order: 5,
    paths: ['curve_strength', 'r_curve_strength', 'g_curve_strength', 'b_curve_strength'],
  },
  {
    key: 'color.lgg', label: 'Lift/Gamma/Gain', order: 6,
    paths: ['lift_r', 'lift_g', 'lift_b', 'gamma_r', 'gamma_g', 'gamma_b', 'gain_r', 'gain_g', 'gain_b'],
  },
  {
    key: 'color.hue_strength', label: 'Hue 曲线强度', order: 8,
    paths: ['hv_h_strength', 'hv_s_strength', 'hv_l_strength', 'lv_s_strength', 'sv_s_strength', 'sv_l_strength'],
  },
  {
    key: 'color.hue_band', label: '六色带', order: 9,
    paths: HUE_BANDS.flatMap((band) => [band.hue, band.sat]),
  },
  { key: 'color.transform', label: '风格化', order: 10, paths: ['grayscale', 'invert'] },
  {
    key: 'color.curves', label: '曲线定义', order: 12,
    paths: COLOR_CURVES.map((curve) => curve.key),
  },
  {
    key: 'color.lut_def', label: 'LUT 定义', order: 13,
    paths: ['lut', 'lut_input_gamma', 'blend_mode'],
  },
  { key: 'color.lut_strength', label: 'LUT 强度', order: 7, paths: ['lut_strength'] },
  { key: 'color.layer', label: '层级混合', order: 11, paths: ['blend_amount'] },
]

export function colorGroupOf(path: string): FieldDisplayGroup | null {
  for (const group of COLOR_GROUPS) {
    if (group.paths.includes(path)) {
      return { key: group.key, label: group.label, order: group.order }
    }
  }
  return null
}

/** 滑杆步长：exposure 0.01，其余 0.001（范围来自目录 min/max）。 */
export function colorSliderStep(path: string): number {
  return path === 'exposure' ? 0.01 : 0.001
}

/** 矩阵路径集合（合并行用）。 */
export const MATRIX_PATH_SET: ReadonlySet<string> = new Set(MATRIX_PATHS)

/** 色相带 12 路径集合。 */
export const HUE_BAND_PATHS: ReadonlySet<string> = new Set(
  HUE_BANDS.flatMap((band) => [band.hue, band.sat]),
)

/** 曲线定义路径集合。 */
export const CURVE_DEF_PATHS: ReadonlySet<string> = new Set(COLOR_CURVES.map((curve) => curve.key))

/** `blend_mode` 枚举（`ColorAdjustSampler` 的五种 + normal）。 */
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'soft_light', 'overlay'] as const

/** `.cube` 路径检查（10-07：相对资源根、大小写不敏感、不读本地绝对路径）。 */
export interface CubePathCheck {
  ok: boolean
  normalized: string
  messages: string[]
}

export function checkCubePath(value: unknown): CubePathCheck {
  const raw = typeof value === 'string' ? value.trim() : ''
  const normalized = raw.replace(/\\/g, '/')
  const messages: string[] = []
  if (raw === '') {
    return { ok: true, normalized, messages }
  }
  if (normalized.startsWith('/')) messages.push('不能是绝对路径（不能以 / 开头）')
  else if (/^[A-Za-z]:/.test(normalized)) messages.push('不能带盘符（如 C:）')
  else if (normalized.startsWith('//')) messages.push('不能是 UNC 路径')
  if (normalized.split('/').includes('..')) messages.push('包含 ..，会逃出资源根')
  if (!/\.cube$/i.test(normalized)) messages.push('LUT 必须是 .cube 文件（扩展名大小写不敏感）')
  const dot = normalized.lastIndexOf('.')
  if (dot === normalized.length) messages.push('扩展名后为空')
  return { ok: messages.length === 0, normalized, messages }
}

/** LUT 强度但无 LUT：运行时 `lut_strength` 被强制为 0（不报错但提示）。 */
export function lutStrengthNotice(input: {
  lut: unknown
  strength: unknown
}): string | null {
  const hasLut = typeof input.lut === 'string' && input.lut.trim() !== ''
  if (hasLut) return null;
  const strength = typeof input.strength === 'number' ? input.strength : 1
  if (Math.abs(strength) < 1e-9) return null
  return 'lut_strength 非 0 但没有 lut：运行时把 lut_strength 强制为 0，不会套 LUT。'
}

/** `lut_input_gamma` 必须 > 0（`ObjectValidator` block；目录 min=0）。 */
export function checkLutGamma(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'lut_input_gamma 需要有限数字'
  if (value <= 0) return 'lut_input_gamma 必须 > 0（运行时校验为 block；目录下界 0 只是输入形态）'
  return null
}

/** 同文档多 ADJUST 轨的覆盖提示（同一实例后发布者覆盖，不做叠乘）。 */
export function colorLayerNotice(input: {
  adjustTrackCount: number
  activeAdjustTrackNames: readonly string[]
}): string | null {
  if (input.adjustTrackCount <= 1) return null
  const active = input.activeAdjustTrackNames
  if (active.length <= 1) {
    return `当前文档有 ${input.adjustTrackCount} 条 ADJUST 轨道：运行时同一实例内后发布者覆盖前者，不会叠乘；当前播放头只有 ${active.length} 条活跃。`
  }
  return `当前文档有 ${input.adjustTrackCount} 条 ADJUST 轨道，播放头处 ${active.length} 条同时活跃（${active.join('、')}）：运行时后发布者覆盖前者，只有最后一条的参数生效。`
}

/** 矩阵格坐标（3×3，行优先）。 */
export function matrixCells(): Array<{ path: string; row: number; col: number; axis: string }> {
  const axes = ['R', 'G', 'B']
  return MATRIX_PATHS.map((path, index) => ({
    path,
    row: Math.floor(index / 3),
    col: index % 3,
    axis: `${axes[Math.floor(index / 3)]}→${axes[index % 3]}`,
  }))
}
