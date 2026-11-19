/**
 * 12-08 位置 / 朝向可写性解析（复用 07 既有读取口径，不做近似换算）。
 *
 * 规则严格对齐 12-08 §4.3 / §4.4：
 * - 绝对位置可写；
 * - 相对世界且原点为固定数值坐标时，写世界点 − 原点；
 * - 相对基准禁止写位置与朝向（只写 fov / zoom）；
 * - 注视目标 / 切线朝向生效时不写朝向角。
 */
import { effectiveValue } from '../authoring/groups.ts'
import { parsePointSource } from '../authoring/pointSource.ts'
import { eachClip } from '../../core/doc/identity.ts'
import { isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../core/doc/types.ts'
import type { PoseDiagnostic, PoseVec3 } from './types.ts'

const CAMERA = 'CAMERA'

/** 位置参考系读取结果。 */
export interface PositionMode {
  mode: 'absolute' | 'relative'
  space: 'world' | 'base'
}

/** 位置可写性检查结果。 */
export interface PositionCheck {
  writable: boolean
  reason: PoseDiagnostic | null
  /** 写入片段的局部坐标；不可写时为 `null`。 */
  local: PoseVec3 | null
}

/** 朝向可写性检查结果。 */
export interface OrientationCheck {
  writable: boolean
  reason: PoseDiagnostic | null
}

export function makeDiagnostic(code: string, message: string, fieldPath?: string): PoseDiagnostic {
  return { code, severity: 'error', message, fieldPath }
}

/** 读取枚举 / token 字段；缺省回落目录默认值，避免缺失字段被读成 `'null'`。 */
function tokenOf(clip: JsonObject, path: string, time: number, catalog: CatalogIndex | undefined): string {
  const def = catalog?.objectDef(CAMERA, path)
  const value = effectiveValue(clip, path, time, def)
  if (typeof value === 'number') {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (value === null || value === undefined) {
    const fallback = def?.default
    return fallback === null || fallback === undefined ? '' : String(fallback)
  }
  return String(value)
}

/** 读取当前位置模式 / 空间（缺省按目录默认：relative + world）。 */
export function positionModeOf(clip: JsonObject, time: number, catalog?: CatalogIndex): PositionMode {
  const mode = tokenOf(clip, 'position_mode', time, catalog)
  const space = tokenOf(clip, 'position_space', time, catalog)
  return {
    mode: mode === 'absolute' ? 'absolute' : 'relative',
    space: space === 'base' ? 'base' : 'world',
  }
}

/**
 * 位置可写性 + 世界点 → 局部坐标换算。
 * 只做「世界点 − 固定原点」这一步确定性换算；其余形态一律禁用并给原因。
 */
export function inspectPosition(clip: JsonObject, time: number, world: PoseVec3, catalog?: CatalogIndex): PositionCheck {
  const { mode, space } = positionModeOf(clip, time, catalog)

  if (mode === 'absolute') {
    return { writable: true, reason: null, local: { ...world } }
  }

  if (space === 'base') {
    return {
      writable: false,
      reason: makeDiagnostic('flight.position.base', '相对基准空间无可靠世界参考系，禁止写位置与朝向，仅可写 fov / zoom'),
      local: null,
    }
  }

  const originRaw = tokenOf(clip, 'position_origin', time, catalog)
  const form = parsePointSource(originRaw)
  if (form.kind !== 'coordinate') {
    return {
      writable: false,
      reason: makeDiagnostic(
        'flight.position.originUnreliable',
        `原点形态 ${form.kind}（空 / 玩家 / 选择器 / 方块 / 结构）无固定世界参考系，禁止写位置`,
      ),
      local: null,
    }
  }

  const originX = effectiveValue(clip, 'position_origin_x', time, catalog?.objectDef(CAMERA, 'position_origin_x'))
  const originY = effectiveValue(clip, 'position_origin_y', time, catalog?.objectDef(CAMERA, 'position_origin_y'))
  const originZ = effectiveValue(clip, 'position_origin_z', time, catalog?.objectDef(CAMERA, 'position_origin_z'))
  if (!isFiniteNumber(originX) || !isFiniteNumber(originY) || !isFiniteNumber(originZ)) {
    return {
      writable: false,
      reason: makeDiagnostic('flight.position.originCoords', '固定原点坐标缺失或非有限，禁止写位置'),
      local: null,
    }
  }

  return {
    writable: true,
    reason: null,
    local: { x: world.x - originX, y: world.y - originY, z: world.z - originZ },
  }
}

/** 朝向可写性：基准空间 / 注视目标 / 切线朝向三种情形不写朝向角。 */
export function inspectOrientation(clip: JsonObject, time: number, catalog?: CatalogIndex): OrientationCheck {
  const { space } = positionModeOf(clip, time, catalog)
  if (space === 'base') {
    return {
      writable: false,
      reason: makeDiagnostic('flight.orientation.base', '相对基准空间禁止写朝向角'),
    }
  }

  const lookAt = tokenOf(clip, 'look_at', time, catalog)
  if (lookAt !== 'none') {
    return {
      writable: false,
      reason: makeDiagnostic('flight.orientation.lookAt', '目标使用注视目标，朝向由目标方向决定，不写朝向角'),
    }
  }

  const orient = tokenOf(clip, 'orient', time, catalog)
  if (orient === 'tangent') {
    return {
      writable: false,
      reason: makeDiagnostic('flight.orientation.tangent', '目标使用切线朝向，角度运行时计算，不写朝向角'),
    }
  }

  return { writable: true, reason: null }
}

/** 读片段 `objects`（只读语义；缺失返回空对象）。 */
export function objectsOfClip(clip: JsonObject): JsonObject {
  return isJsonObject(clip.objects) ? clip.objects : {}
}

/** 读取一个有效数字；非有限 / 缺失返回 `null`。 */
export function finiteOrNull(value: JsonValue): number | null {
  return isFiniteNumber(value) ? value : null
}

/** 按片段运行时 id 找片段（纯文档遍历，不依赖注册表）。 */
export function findClipById(doc: ScriptDoc, clipId: string): JsonObject | null {
  let found: JsonObject | null = null
  eachClip(doc, (clip) => {
    if (found === null && typeof clip.id === 'string' && clip.id === clipId) {
      found = clip
    }
  })
  return found
}
