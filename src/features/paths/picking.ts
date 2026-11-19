/**
 * 12-10 曲线工具 · 控制点拾取：可用性判定 + 正交画布逆变换 → 世界点 → 控制点数值。
 *
 * 边界（对齐 `plan/12/12-10-curve-tools.md` 三、4.4）：
 * - 只在能忠实换算的场景可用：位置绝对、无注视目标、无切线朝向、无路径切线依赖；
 *   相对基准 / 动态原点片段禁用并提示改数值输入；
 * - 07 预览画布是**正交投影**（`ViewTransform{scale,offsetX,offsetY}` + 轴对），
 *   拾取 = 屏幕点逆变换得可见两轴世界值，隐藏轴取固定平面值（既有控制点隐藏轴值优先，
 *   其次段起点 / 平面同轴值）；这就是「屏幕点 → 固定平面求交 → 世界点」，不需要额外 3D 服务；
 * - 没有深度缓冲，结果是固定平面上的近似，必须标注「需目视确认」；
 * - 只改选中的那一个控制点，不增删数量（贝塞尔固定两个），不写位置关键帧；
 * - 纯逻辑层：逆变换与形态换算不依赖 Vue / 运行时。
 */
import type { JsonObject, ScriptDoc } from '../../core/doc/types.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import { findClipById } from '../../core/paths/collection.ts'
import { PATH_AXES, type PathAxis } from '../../core/paths/types.ts'
import type { Vec3 } from '../../core/paths/sampling.ts'
import type { ViewTransform, ProjectionPair } from './previewCanvas.ts'
import { parsePointSource } from '../authoring/pointSource.ts'
import type { ControlMode } from './shapeEntries.ts'

/** 拾取结果固定标注（面板 / 自检都引用这一条，不另写措辞）。 */
export const PICK_APPROX_NOTE = '基于当前视角与固定平面的近似，需目视确认'

/** 画布轴对 → 水平 / 竖直 / 隐藏轴（与 `previewCanvas.ts` 的 `PAIR_AXES` 同口径）。 */
const PAIR_AXES: Record<ProjectionPair, { horizontal: PathAxis; vertical: PathAxis; hidden: PathAxis }> = {
  xz: { horizontal: 'x', vertical: 'z', hidden: 'y' },
  xy: { horizontal: 'x', vertical: 'y', hidden: 'z' },
  yz: { horizontal: 'y', vertical: 'z', hidden: 'x' },
}

/** 可用性判定结果：`available === false` 时 `reasons` 至少一条「改数值输入」提示。 */
export interface PickEligibility {
  available: boolean
  reasons: string[]
}

/** 当次画布帧：真实宽高 + 正交 ViewTransform + 轴对（由预览画布传入）。 */
export interface PickFrame {
  width: number
  height: number
  transform: ViewTransform
  pair: ProjectionPair
}

// ── 对象字段读取（与 generatorWizard 同口径：静态 value 或首帧 keyframes） ──────

function scalarString(objects: JsonObject, path: string, fallback: string): string {
  const raw = objects[path]
  if (!isJsonObject(raw)) {
    return fallback
  }
  if (Array.isArray(raw.keyframes) && raw.keyframes.length > 0) {
    const first = raw.keyframes[0]
    if (isJsonObject(first) && typeof first.value === 'string') {
      return first.value
    }
  }
  return typeof raw.value === 'string' ? raw.value : fallback
}

// ── 可用性判定 ──────────────────────────────────────────────────────────────

/**
 * 判定一组片段对象是否可拾取控制点。
 * 顺序：位置模式 → 基准系 → 动态原点 → 注视目标 → 切线朝向。
 * 画布正交投影始终可用，不再因「无相机姿态 / 窗口尺寸」禁用。
 */
export function evaluatePickEligibility(objects: JsonObject | undefined): PickEligibility {
  const reasons: string[] = []
  const owner: JsonObject = objects ?? {}

  const mode = scalarString(owner, 'position_mode', 'relative')
  if (mode !== 'absolute') {
    reasons.push('位置模式为相对（基准 / 原点偏移）：控制点拾取不可用，请改数值输入')
  }

  const space = scalarString(owner, 'position_space', 'world')
  if (space === 'base') {
    reasons.push('基准坐标系（base）下位置不可换算：请改数值输入')
  }

  const originText = scalarString(owner, 'position_origin', '')
  const originKind = parsePointSource(originText).kind
  if (mode === 'relative' && originKind !== 'coordinate' && originKind !== 'empty') {
    reasons.push('原点为动态引用（玩家 / 方块 / 结构 / 选择器）：请改数值输入')
  }

  const lookAt = scalarString(owner, 'look_at', 'none')
  if (lookAt !== 'none') {
    reasons.push('注视目标生效：朝向随目标联动，请改数值输入')
  }

  const orient = scalarString(owner, 'orient', 'manual')
  if (orient === 'tangent') {
    reasons.push('切线朝向生效：朝向由路径切线决定，请改数值输入')
  }

  return { available: reasons.length === 0, reasons }
}

/**
 * 按片段 id 判定拾取可用性。片段不存在 / 无 objects 按不可用处理。
 * `clipKey` 取文档片段 id（与 07 路径条目 `clip` 字段一致）。
 */
export function canPickControlPoint(doc: ScriptDoc, clipKey: string): PickEligibility {
  const clip = findClipById(doc, clipKey)
  if (clip === undefined) {
    return { available: false, reasons: ['目标片段不存在：请改数值输入'] }
  }
  const objects = isJsonObject(clip.objects) ? (clip.objects as JsonObject) : undefined
  return evaluatePickEligibility(objects)
}

// ── 正交逆变换 ──────────────────────────────────────────────────────────────

/** 一次拾取输入：屏幕点、画布帧、段起点与控制点写法、固定平面值、既有控制点。 */
export interface PickInput {
  /** 屏幕像素坐标（左上原点，与画布 SVG 同坐标系）。 */
  screen: { x: number; y: number }
  frame: PickFrame
  /** 段起点（相对写法的换算基准）。 */
  segmentStart: Vec3
  controlMode: ControlMode
  axes: readonly PathAxis[]
  /** 固定平面值：隐藏轴缺省取值（既有控制点隐藏轴值优先于本平面值）。 */
  plane: Vec3
  /** 被拾取的既有控制点（保留隐藏轴分量；形态以既有对象为准）。 */
  existingControl?: JsonObject
}

/** 拾取结果：世界点 + 按形态换算后的控制点 JSON + 近似标注。 */
export interface PickResult {
  world: Vec3
  control: JsonObject
  note: string
}

const SCALE_EPSILON = 1e-9

function axisIsRelative(point: JsonObject): boolean {
  return 'dx' in point && 'dy' in point && 'dz' in point
}

function axisWorldValue(point: JsonObject, axis: PathAxis, segmentStart: Vec3): number | undefined {
  if (axisIsRelative(point)) {
    const relative = point[`d${axis}` as 'dx' | 'dy' | 'dz']
    return typeof relative === 'number' ? relative + segmentStart[axis] : undefined
  }
  const absolute = point[axis]
  return typeof absolute === 'number' ? absolute : undefined
}

/**
 * 屏幕点 → 正交逆变换得可见两轴世界值 → 隐藏轴取固定平面 / 既有控制点分量 →
 * 按控制点形态换算 JSON。帧尺寸非法、变换退化时返回 null。
 */
export function pickControlPoint(input: PickInput): PickResult | null {
  const frame = input.frame
  const transform = frame.transform
  if (!(frame.width > 0) || !(frame.height > 0)) {
    return null
  }
  if (!Number.isFinite(transform.scale) || transform.scale <= SCALE_EPSILON) {
    return null
  }

  // 逆 `applyTransform`：screen = world * scale + offset（y 翻转已在变换内）。
  const worldVisibleX = (input.screen.x - transform.offsetX) / transform.scale
  const worldVisibleY = (input.screen.y - transform.offsetY) / transform.scale
  if (!Number.isFinite(worldVisibleX) || !Number.isFinite(worldVisibleY)) {
    return null
  }

  const basis = PAIR_AXES[frame.pair]
  const axesSet = new Set<PathAxis>(input.axes.filter((axis): axis is PathAxis => PATH_AXES.includes(axis)))
  const world: Vec3 = { x: 0, y: 0, z: 0 }
  world[basis.horizontal] = worldVisibleX
  world[basis.vertical] = worldVisibleY

  // 隐藏轴：既有控制点保留原值（世界口径），否则取固定平面值。
  const existingHidden = input.existingControl !== undefined
    ? axisWorldValue(input.existingControl, basis.hidden, input.segmentStart)
    : undefined
  world[basis.hidden] = existingHidden !== undefined ? existingHidden : input.plane[basis.hidden]

  for (const axis of PATH_AXES) {
    if (!axesSet.has(axis)) {
      world[axis] = 0
    }
  }

  const control: JsonObject = input.controlMode === 'absolute'
    ? { x: world.x, y: world.y, z: world.z }
    : {
      dx: world.x - input.segmentStart.x,
      dy: world.y - input.segmentStart.y,
      dz: world.z - input.segmentStart.z,
    }
  return { world, control, note: PICK_APPROX_NOTE }
}
