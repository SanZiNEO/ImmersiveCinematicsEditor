/**
 * 07-03 点源五形态：`ref` 字符串 ↔ 形态/载荷 的往返解析与本地校验。
 * 判定顺序严格对齐 `PointKinds.kindOf`。
 */
export type RefKind = 'empty' | 'player' | 'coordinate' | 'block' | 'selector' | 'structure'

export interface PointSourceForm {
  kind: RefKind
  /** 选择器原串 / 方块 id / 结构 id。 */
  text: string
  /** 方块半径（缺省 16，仅 block）。 */
  radius: number
}

export type PointSourceIssue = { field: string; message: string }

/** 解析一个 `ref` 字符串；空串 → empty。 */
export function parsePointSource(raw: unknown, defaultRadius = 16): PointSourceForm {
  if (typeof raw !== 'string' || raw === '') {
    return { kind: 'empty', text: '', radius: defaultRadius }
  }
  if (raw.startsWith('@') || raw.startsWith('uuid:')) {
    return { kind: 'selector', text: raw, radius: defaultRadius }
  }
  if (raw.startsWith('block:')) {
    const payload = raw.slice('block:'.length)
    const lastColon = payload.lastIndexOf(':')
    if (lastColon > 0) {
      const suffix = payload.slice(lastColon + 1)
      if (/^\d+$/.test(suffix)) {
        const radius = Number(suffix)
        if (radius > 0) {
          return { kind: 'block', text: payload.slice(0, lastColon), radius }
        }
      }
    }
    return { kind: 'block', text: payload, radius: defaultRadius }
  }
  if (raw === 'player') {
    return { kind: 'player', text: '', radius: defaultRadius }
  }
  if (raw === 'coordinate') {
    return { kind: 'coordinate', text: '', radius: defaultRadius }
  }
  return { kind: 'structure', text: raw, radius: defaultRadius }
}

/** 形态 + 载荷 → 写盘字符串；非法载荷返回 null（调用方阻止提交）。 */
export function formatPointSource(form: PointSourceForm): string | null {
  switch (form.kind) {
    case 'empty':
      return ''
    case 'player':
      return 'player'
    case 'coordinate':
      return 'coordinate'
    case 'selector':
      return form.text.startsWith('@') || form.text.startsWith('uuid:') ? form.text : null
    case 'block': {
      if (form.text.length === 0 || form.text.startsWith('@') || form.text.startsWith('uuid:') || form.text.startsWith('block:')) {
        return null
      }
      const radius = Math.trunc(form.radius)
      if (!Number.isFinite(radius) || radius <= 0) {
        return null
      }
      return radius === 16 ? `block:${form.text}` : `block:${form.text}:${radius}`
    }
    case 'structure':
      return isStructureId(form.text) ? form.text : null
    default:
      return null
  }
}

/** 结构 id 不得撞保留字 / 前缀（否则运行时归到别的形态）。 */
export function isStructureId(text: string): boolean {
  if (text.length === 0) {
    return false
  }
  if (text === 'player' || text === 'coordinate') {
    return false
  }
  return !(text.startsWith('@') || text.startsWith('uuid:') || text.startsWith('block:'))
}

/** 往返自检：解析→格式化→再解析，形态一致。 */
export function pointSourceRoundTrip(raw: string): boolean {
  const first = parsePointSource(raw)
  const formatted = formatPointSource(first)
  if (formatted === null) {
    return false
  }
  const second = parsePointSource(formatted)
  return first.kind === second.kind
}

/** 查询当前可用形态（facing_entity 只允许 selector；原点五形态都可用）。 */
export function allowedPointKinds(field: string): RefKind[] {
  if (field === 'facing_entity' || field === 'yaw_base_selector') {
    return ['selector']
  }
  return ['empty', 'player', 'coordinate', 'block', 'selector', 'structure']
}

/** 校验 `look_at_part`（三轴 0–100）。 */
export function validateLookAtPart(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 3) {
    return 'look_at_part 需要三个分量 [x,y,z]'
  }
  for (let index = 0; index < value.length; index += 1) {
    const component = value[index]
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      return `look_at_part[${index}] 需要有限数字`
    }
    if (component < 0 || component > 100) {
      return `look_at_part[${index}] 必须落在 0–100（实际 ${component}）`
    }
  }
  return null
}

/** `facing_source=auto` 的解析与冲突。 */
export function resolveFacingAuto(input: {
  target: string
  entity: string
  originKind: RefKind
}): { branch: 'line' | 'entity' | 'world'; warning: string | null } {
  const hasTarget = input.target.length > 0
  const hasEntity = input.entity.length > 0
  if (hasTarget && hasEntity) {
    return { branch: 'line', warning: 'facing_source=auto 时 target 与 entity 不能同时非空（冲突）' }
  }
  if (hasTarget) {
    return { branch: 'line', warning: null }
  }
  if (hasEntity) {
    return { branch: 'entity', warning: null }
  }
  if (input.originKind === 'selector' || input.originKind === 'player' || input.originKind === 'empty') {
    return { branch: 'entity', warning: null }
  }
  return { branch: 'world', warning: null }
}
