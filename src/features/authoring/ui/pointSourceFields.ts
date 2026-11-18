/**
 * 07-03 点源五形态受约束表单模型（纯逻辑，不触 DOM / 不引 Vue）。
 *
 * - 形态下拉：判定顺序与 core `parsePointSource` 一致
 *   （`@`/`uuid:` → selector，`block:` → block，`player`，`coordinate`，其余 → structure）；
 * - 按形态显示载荷：坐标三轴 / 方块 id + 可选半径（默认 16）/ 选择器原串 / 结构 id；
 * - 结构 id 本地校验复用 `isStructureId`；
 * - `look_at` 五个枚举分支（none/player/coordinate/entity/block）独立载荷，part 0–100 越界拒绝；
 * - 偏移组与冻结字段的可用条件：不满足时禁用并标「不读取」，值保留；
 * - `facing_source=auto` 且 target 与 entity 同时非空 → 立刻阻止提交；
 * - 写出的字符串一律走 `formatPointSource`。
 */
import {
  parsePointSource,
  formatPointSource,
  isStructureId,
  allowedPointKinds,
  validateLookAtPart,
  resolveFacingAuto,
  type PointSourceForm,
  type RefKind,
} from '../pointSource.ts'

// ── 五形态草稿 ──────────────────────────────────────────────────────────────

export type CoordTriple = [number | null, number | null, number | null]

/** 表单草稿（与写盘字段一一对应；坐标载荷落在兄弟 `*_x/y/z`）。 */
export interface PointSourceDraft {
  kind: RefKind
  /** 选择器原串 / 方块 id / 结构 id。 */
  text: string
  /** 方块半径（缺省 16，仅 block）。 */
  radius: number
  /** coordinate 形态的三轴（null = 未写，运行期按 0 读）。 */
  coords: CoordTriple
}

/** 从现有 ref 字符串 + 兄弟坐标字段折成草稿。 */
export function draftPointSource(
  raw: unknown,
  siblings: { x?: unknown; y?: unknown; z?: unknown },
  defaultRadius = 16,
): PointSourceDraft {
  const form: PointSourceForm = parsePointSource(raw, defaultRadius)
  return {
    kind: form.kind,
    text: form.text,
    radius: form.radius,
    coords: [coerceCoord(siblings.x), coerceCoord(siblings.y), coerceCoord(siblings.z)],
  }
}

function coerceCoord(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 该字段允许的形态（`facing_entity` / `yaw_base_selector` 只允许 selector）。 */
export function allowedKinds(field: string): RefKind[] {
  return allowedPointKinds(field)
}

export interface DraftValidation {
  ok: boolean
  /** 写出的 ref 字符串；非法为 `null`。 */
  ref: string | null
  issues: Array<{ field: string; message: string }>
}

/**
 * 校验草稿并拼写出 ref 字符串。
 *
 * 非法载荷本地拒绝（不写出去等运行时兜底）；坐标三轴不进 ref 字符串，由兄弟字段承载。
 */
export function validatePointDraft(field: string, draft: PointSourceDraft): DraftValidation {
  const issues: Array<{ field: string; message: string }> = []

  if (!allowedKinds(field).includes(draft.kind)) {
    issues.push({ field, message: `该字段不支持形态 ${draft.kind}` })
    return { ok: false, ref: null, issues }
  }

  if (draft.kind === 'block') {
    const radius = Math.trunc(draft.radius)
    if (!Number.isFinite(radius) || radius <= 0) {
      issues.push({ field, message: '方块半径需要正整数' })
    }
  }
  if (draft.kind === 'selector' && draft.text.length === 0) {
    issues.push({ field, message: '选择器不能为空' })
  }
  if (draft.kind === 'structure' && !isStructureId(draft.text)) {
    issues.push({ field, message: '结构 id 不能是 player / coordinate，也不能以 @、uuid:、block: 开头' })
  }

  const ref = formatPointSource({ kind: draft.kind, text: draft.text, radius: draft.radius })
  if (ref === null) {
    issues.push({ field, message: '载荷非法，无法生成引用字符串' })
    return { ok: false, ref: null, issues }
  }

  // coordinate 三轴：允许 null（未写 = 0）；填了就必须是有限数字。
  for (let index = 0; index < 3; index += 1) {
    const coord = draft.coords[index]
    if (coord !== null && !Number.isFinite(coord)) {
      issues.push({ field: `${field}_${axisName(index)}`, message: '坐标需要有限数字或留空' })
    }
  }

  return { ok: issues.length === 0, ref: issues.length === 0 ? ref : null, issues }
}

function axisName(index: number): 'x' | 'y' | 'z' {
  return index === 0 ? 'x' : index === 1 ? 'y' : 'z'
}

// ── look_at 枚举分支 ─────────────────────────────────────────────────────────

export type LookAtBranch = 'none' | 'player' | 'coordinate' | 'entity' | 'block'

/** `look_at` 表单草稿（载荷字段与 schema 同名兄弟字段对应）。 */
export interface LookAtDraft {
  branch: LookAtBranch
  /** entity：选择器原串。 */
  selector: string
  /** entity：part 三轴 0–100。 */
  part: CoordTriple
  /** coordinate：目标三轴（与结构 id 二选一）。 */
  coords: CoordTriple
  /** coordinate：结构 id。 */
  structure: string
  /** block：方块字符串。 */
  block: string
}

const LOOK_AT_BRANCHES: readonly LookAtBranch[] = ['none', 'player', 'coordinate', 'entity', 'block']

function readBranch(raw: unknown): LookAtBranch {
  const text = typeof raw === 'string' ? raw : 'none'
  return (LOOK_AT_BRANCHES as readonly string[]).includes(text) ? (text as LookAtBranch) : 'none'
}

/** 从对象面折 look_at 草稿。 */
export function draftLookAt(objects: Record<string, unknown>): LookAtDraft {
  const value = (path: string): unknown => objects[path]
  const partRaw = (index: 0 | 1 | 2): number | null => {
    const key = ['look_at_part.x', 'look_at_part.y', 'look_at_part.z'][index]
    return coerceCoord(value(key))
  }
  const coordRaw = (index: 0 | 1 | 2): number | null => {
    const key = ['look_at_target_x', 'look_at_target_y', 'look_at_target_z'][index]
    return coerceCoord(value(key))
  }
  return {
    branch: readBranch(value('look_at')),
    selector: typeof value('look_at_selector') === 'string' ? (value('look_at_selector') as string) : '@p',
    part: [partRaw(0), partRaw(1), partRaw(2)],
    coords: [coordRaw(0), coordRaw(1), coordRaw(2)],
    structure: typeof value('look_at_target_structure') === 'string'
      ? (value('look_at_target_structure') as string)
      : '',
    block: typeof value('look_at_target_block') === 'string'
      ? (value('look_at_target_block') as string)
      : '',
  }
}

/** 各分支的载荷可见性 / 可用条件。 */
export interface LookAtBranchState {
  selectorVisible: boolean
  partVisible: boolean
  coordsVisible: boolean
  structureVisible: boolean
  blockVisible: boolean
  /** 结构非空时坐标字段禁用（二选一）。 */
  coordsDisabledByStructure: boolean
  freezeAvailable: boolean
  /** 隐藏分支里已有值的标注（不删除）。 */
  legacyNote: string
}

export function lookAtBranchState(branch: LookAtBranch): LookAtBranchState {
  switch (branch) {
    case 'none':
      return {
        selectorVisible: false,
        partVisible: false,
        coordsVisible: false,
        structureVisible: false,
        blockVisible: false,
        coordsDisabledByStructure: false,
        freezeAvailable: false,
        legacyNote: 'look_at=none：注视载荷不读取（值保留）',
      }
    case 'player':
      return {
        selectorVisible: false,
        partVisible: false,
        coordsVisible: false,
        structureVisible: false,
        blockVisible: false,
        coordsDisabledByStructure: false,
        freezeAvailable: false,
        legacyNote: '',
      }
    case 'coordinate':
      return {
        selectorVisible: false,
        partVisible: false,
        coordsVisible: true,
        structureVisible: true,
        blockVisible: false,
        coordsDisabledByStructure: false,
        freezeAvailable: false,
        legacyNote: '',
      }
    case 'entity':
      return {
        selectorVisible: true,
        partVisible: true,
        coordsVisible: false,
        structureVisible: false,
        blockVisible: false,
        coordsDisabledByStructure: false,
        freezeAvailable: true,
        legacyNote: '',
      }
    case 'block':
      return {
        selectorVisible: false,
        partVisible: false,
        coordsVisible: false,
        structureVisible: false,
        blockVisible: true,
        coordsDisabledByStructure: false,
        freezeAvailable: false,
        legacyNote: '',
      }
  }
}

/** coordinate 分支：结构非空时坐标字段禁用（二选一）。 */
export function coordsBlockedByStructure(draft: LookAtDraft): boolean {
  return draft.branch === 'coordinate' && draft.structure.trim().length > 0
}

/** 校验 look_at 草稿；返回问题列表（空 = 可提交）。 */
export function validateLookAtDraft(draft: LookAtDraft): Array<{ field: string; message: string }> {
  const issues: Array<{ field: string; message: string }> = []
  const state = lookAtBranchState(draft.branch)

  if (draft.branch === 'entity') {
    if (draft.selector.trim().length === 0) {
      issues.push({ field: 'look_at_selector', message: 'entity 分支需要选择器' })
    }
    const partCheck = validateLookAtPart(draft.part)
    if (partCheck !== null) {
      issues.push({ field: 'look_at_part', message: partCheck })
    }
  }

  if (draft.branch === 'coordinate') {
    const hasStructure = draft.structure.trim().length > 0
    const hasCoords = draft.coords.some((coord) => coord !== null)
    if (hasStructure) {
      if (!isStructureId(draft.structure)) {
        issues.push({ field: 'look_at_target_structure', message: '结构 id 撞保留字或前缀，无法识别' })
      }
    } else if (!hasCoords) {
      issues.push({ field: 'look_at_target', message: 'coordinate 分支需要坐标或结构 id 二选一' })
    }
    for (const coord of draft.coords) {
      if (coord !== null && !Number.isFinite(coord)) {
        issues.push({ field: 'look_at_target', message: '坐标需要有限数字或留空' })
      }
    }
  }

  if (draft.branch === 'block') {
    if (draft.block.trim().length === 0) {
      issues.push({ field: 'look_at_target_block', message: 'block 分支需要方块字符串' })
    } else if (!isStructureId(draft.block) && !draft.block.startsWith('block:')) {
      issues.push({ field: 'look_at_target_block', message: '方块字符串非法（会被解析成别的形态）' })
    }
  }

  void state
  return issues
}

// ── facing_source=auto 冲突 ──────────────────────────────────────────────────

export interface FacingAutoState {
  /** target 与 entity 同时非空：阻止提交。 */
  conflict: boolean
  branch: 'line' | 'entity' | 'world'
  warning: string | null
}

/** auto 解析；同时非空是冲突状态，界面立刻红框、不能提交。 */
export function facingAutoState(target: string, entity: string, originKind: RefKind): FacingAutoState {
  const result = resolveFacingAuto({ target, entity, originKind })
  return { conflict: result.warning !== null, branch: result.branch, warning: result.warning }
}

// ── 偏移组 / 冻结可用条件 ────────────────────────────────────────────────────

/**
 * 偏移 `space=base` 但当前没有 base 参考系时：偏移不生效，值保留。
 */
export function offsetSpaceState(offsetSpace: string, hasBaseFrame: boolean): { read: boolean; note: string } {
  if (offsetSpace === 'base' && !hasBaseFrame) {
    return { read: false, note: '没有 base 参考系，偏移不生效（值保留）' }
  }
  return { read: true, note: '' }
}

/** 端点冻结是否可用：仅端点是选择器形态时读取。 */
export function freezeAvailableForEndpoint(endpointRef: string): { read: boolean; note: string } {
  const kind = parsePointSource(endpointRef).kind
  if (kind === 'selector') {
    return { read: true, note: '' }
  }
  return { read: false, note: '仅端点为选择器时冻结读取' }
}
