/**
 * 连续性诊断的纯模型（08-06）。
 *
 * 只读脚本级 `meta` 字段与 CAMERA 片段字段，把它们映射成"到达时会发生什么"；
 * 不调用运行时生命周期实现，不推断游戏内实际在播集合，也不产生任何命令。
 *
 * 字段缺省值按 02 目录（`src/core/schema/catalog/meta.ts`），本模块只用于解释，
 * 不回写默认值、不改文档。
 */
import type { ClipViewEntry, TrackViewEntry } from '../../../workbench/api/documents.ts'
import { CAMERA_TRACK_TYPE } from '../transition/model.ts'
import type {
  TransitionBoundary,
  TransitionDocumentView,
  TransitionIssue,
} from '../transition/model.ts'
import type { JsonObject } from '../../../core/doc/types.ts'

/** 段内常量：字段缺省值（与 02 目录一致，仅用于解释）。 */
export const CONTINUITY_DEFAULTS = {
  play_mode: 'parallel',
  priority: 0,
  interruptible: true,
  skippable: true,
  hold_at_end: false,
  macro_loop: false,
  macro_loop_count: -1,
  macro_loop_mode: 'repeat',
} as const

export const PLAY_MODES = ['parallel', 'exclusive', 'interruptible'] as const
export type PlayMode = (typeof PLAY_MODES)[number]

export const PLAY_MODE_LABELS: Readonly<Record<PlayMode, string>> = {
  parallel: '平行（与其它脚本共存）',
  exclusive: '独占（别人到达时排队）',
  interruptible: '可打断（能被新脚本顶掉）',
}

export const MACRO_LOOP_MODES = ['repeat', 'pingpong'] as const
export type MacroLoopMode = (typeof MACRO_LOOP_MODES)[number]

export const MACRO_LOOP_MODE_LABELS: Readonly<Record<MacroLoopMode, string>> = {
  repeat: '正向重复',
  pingpong: '正反交替',
}

/** 脚本级字段（已按 02 缺省值解释，并标出是否显式声明）。 */
export interface ContinuityMeta {
  playMode: PlayMode
  playModeDeclared: boolean
  priority: number
  interruptible: boolean
  skippable: boolean
  skipVoteRatio: number | null
  holdAtEnd: boolean
  macroLoop: boolean
  macroLoopCount: number
  macroLoopMode: MacroLoopMode
}

/** 一条到达规则（枚举 + 文字，不是可执行判断）。 */
export interface ArrivalRule {
  code: string
  /** 前提（当前在播集合的情形描述）。 */
  condition: string
  /** 结果。 */
  outcome: string
  /** 依据的字段。 */
  fields: string[]
}

/** 退场门禁一行。 */
export interface ExitGate {
  code: string
  name: string
  /** `allowed`：完全放行；`conditional`：取决于字段；`blocked`：被字段拒绝。 */
  status: 'allowed' | 'conditional' | 'blocked'
  gate: string
  fields: string[]
}

/** 片段循环一行。 */
export interface ClipLoopEntry {
  trackId: string
  trackName: string
  clipKey: string
  label: string
  loop: boolean
  loopCount: number | null
  loopMode: string
  infinite: boolean
  /** 是否参与叠化 / 参数过渡对（有限且非片段内循环）。 */
  participatesInTransition: boolean
  /** 该片段与交界的关系说明。 */
  note: string
}

/** 交界一行（只放摘要，不复制 lane 视图与通道表）。 */
export interface BoundaryEntry {
  id: string
  trackName: string
  aLabel: string
  bLabel: string
  crossfadeOverlapStart: number | null
  crossfadeOverlapEnd: number | null
  crossfadeOverlapDuration: number
  /** B 的两端不透明度；`null` = 不是 0→1 两端帧。 */
  crossfadeEndpoints: { from: number; to: number } | null
  crossfadeIdentified: boolean
  paramType: string
  paramWindowStart: number | null
  paramWindowEnd: number | null
  paramWindowWidth: number
  paramInterrupt: string
  coexistCoverage: 'none' | 'partial' | 'full'
  state: string
}

/** 连续性诊断结果。 */
export interface ContinuityView {
  meta: ContinuityMeta
  /** 同脚本再触发的唯一规则。 */
  sameScript: ArrivalRule
  /** 跨脚本到达的三条规则（按当前在播集合的情形）。 */
  crossScript: ArrivalRule[]
  /** 队列规则说明。 */
  queue: { summary: string; details: string[] }
  /** 退场门禁表。 */
  gates: ExitGate[]
  clipLoops: ClipLoopEntry[]
  boundaries: BoundaryEntry[]
  issues: TransitionIssue[]
  /** 宏循环说明（开关、范围、复位）。 */
  macroLoopText: string
  /** 片段循环说明（与主时间轴的关系）。 */
  clipLoopText: string
}

/** 读布尔：显式 `true` 才算开（字段缺失取 02 缺省值）。 */
function readBool(meta: JsonObject, key: keyof typeof CONTINUITY_DEFAULTS, fallback: boolean): boolean {
  const value = meta[key]
  return typeof value === 'boolean' ? value : fallback
}

/** 读整数：有限数字才算，否则取缺省值。 */
function readInt(meta: JsonObject, key: keyof typeof CONTINUITY_DEFAULTS, fallback: number): number {
  const value = meta[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
}

/** 读枚举：只接受目录里的枚举值，否则取缺省值。 */
function readPlayMode(meta: JsonObject): { value: PlayMode; declared: boolean } {
  const value = meta.play_mode
  if (typeof value === 'string' && (PLAY_MODES as readonly string[]).includes(value)) {
    return { value: value as PlayMode, declared: true }
  }
  return { value: 'parallel', declared: false }
}

function readMacroLoopMode(meta: JsonObject): MacroLoopMode {
  const value = meta.macro_loop_mode
  if (typeof value === 'string' && (MACRO_LOOP_MODES as readonly string[]).includes(value)) {
    return value as MacroLoopMode
  }
  return 'repeat'
}

/** 读脚本级字段。 */
export function readContinuityMeta(meta: JsonObject | null): ContinuityMeta {
  const source = meta ?? {}
  const playMode = readPlayMode(source)
  const ratio = source.skip_vote_ratio
  return {
    playMode: playMode.value,
    playModeDeclared: playMode.declared,
    priority: readInt(source, 'priority', CONTINUITY_DEFAULTS.priority),
    interruptible: readBool(source, 'interruptible', CONTINUITY_DEFAULTS.interruptible),
    skippable: readBool(source, 'skippable', CONTINUITY_DEFAULTS.skippable),
    skipVoteRatio: typeof ratio === 'number' && Number.isFinite(ratio) ? Math.trunc(ratio) : null,
    holdAtEnd: readBool(source, 'hold_at_end', CONTINUITY_DEFAULTS.hold_at_end),
    macroLoop: readBool(source, 'macro_loop', CONTINUITY_DEFAULTS.macro_loop),
    macroLoopCount: readInt(source, 'macro_loop_count', CONTINUITY_DEFAULTS.macro_loop_count),
    macroLoopMode: readMacroLoopMode(source),
  }
}

/** 同脚本再触发：只看 `interruptible`，`play_mode` 不参与。 */
function sameScriptRule(meta: ContinuityMeta): ArrivalRule {
  if (meta.interruptible) {
    return {
      code: 'same.replaced',
      condition: '同一脚本再次被触发',
      outcome: '替换当前实例：只保留一个活跃实例',
      fields: ['interruptible = 开'],
    }
  }
  return {
    code: 'same.queued',
    condition: '同一脚本再次被触发',
    outcome: '进队列，等当前实例结束后开始',
    fields: ['interruptible = 关'],
  }
}

/** 跨脚本到达：先看当前在播集合有没有独占脚本，再看有没有可打断的。 */
function crossScriptRules(): ArrivalRule[] {
  return [
    {
      code: 'cross.exclusive',
      condition: '当前在播集合里有任意独占脚本（play_mode = exclusive）',
      outcome: '新请求一律排队，不打断',
      fields: ['对方的 play_mode', '本脚本 priority（只影响排队次序）'],
    },
    {
      code: 'cross.interruptible',
      condition: '没有独占，但有可打断的脚本（play_mode = interruptible）',
      outcome: '先把可打断的全部退出，再开始本脚本',
      fields: ['对方的 play_mode'],
    },
    {
      code: 'cross.empty',
      condition: '当前为空，或只有平行脚本（play_mode = parallel）',
      outcome: '直接开始，不退出任何人',
      fields: ['对方的 play_mode'],
    },
  ]
}

/** 队列规则。 */
function queueRule(meta: ContinuityMeta): { summary: string; details: string[] } {
  return {
    summary: `按优先级降序排队（本脚本 priority = ${meta.priority}），同优先级先来先服务`,
    details: [
      '队列键是脚本标识：同一脚本再次请求时替换自己的排队位，不占新格',
      '队列不设上限；只有全停或紧急停止才清空',
      '优先级只决定队列次序，不影响正在播的脚本会不会被顶掉',
    ],
  }
}

/** 退场门禁表：自然结束 / 末尾保持 / 跳过 / 系统停止 / 强制退出 / 被顶掉。 */
function exitGates(meta: ContinuityMeta): ExitGate[] {
  const skipGate = meta.skippable
    ? (meta.skipVoteRatio === null
      ? '可跳过（未声明跳过投票比例，跳过请求直接生效）'
      : `可跳过，但需按跳过投票比例 ${meta.skipVoteRatio} 判定`)
    : '被拒绝：脚本声明不可跳过（skippable = 关）'
  return [
    {
      code: 'exit.natural',
      name: '自然结束',
      status: meta.holdAtEnd ? 'blocked' : 'allowed',
      gate: meta.holdAtEnd ? '被拒绝：末尾保持为开（hold_at_end）时停在末帧' : '放行：时间轴走完即退场',
      fields: ['hold_at_end'],
    },
    {
      code: 'exit.hold',
      name: '末尾保持',
      status: meta.holdAtEnd ? 'conditional' : 'allowed',
      gate: meta.holdAtEnd ? '停在末帧，不自动退场，等待系统停止或在外的退出条件' : '未开启，末帧不停留',
      fields: ['hold_at_end'],
    },
    {
      code: 'exit.skip',
      name: '跳过请求',
      status: meta.skippable ? 'conditional' : 'blocked',
      gate: skipGate,
      fields: ['skippable', 'skip_vote_ratio'],
    },
    {
      code: 'exit.system-stop',
      name: '系统停止',
      status: 'allowed',
      gate: '不受字段限制：任何脚本都可被系统停止',
      fields: [],
    },
    {
      code: 'exit.force',
      name: '强制退出',
      status: 'allowed',
      gate: '不受字段限制：强制退出不经过字段门禁',
      fields: [],
    },
    {
      code: 'exit.replaced',
      name: '被新脚本顶掉',
      status: meta.interruptible ? 'allowed' : 'blocked',
      gate: meta.interruptible ? '本身可被打断；不过对方遇到独占脚本时仍会被排队' : '被拒绝：不可打断，对方只能排队等待',
      fields: ['interruptible', '对方 play_mode'],
    },
  ]
}

/** CAMERA 轨道的片段循环条目。 */
function clipLoopEntries(tracks: readonly TrackViewEntry[]): ClipLoopEntry[] {
  const entries: ClipLoopEntry[] = []
  for (const track of tracks) {
    if (track.type !== CAMERA_TRACK_TYPE) {
      continue
    }
    for (const clip of track.clips) {
      entries.push(clipLoopEntry(track, clip))
    }
  }
  return entries
}

function clipLoopEntry(track: TrackViewEntry, clip: ClipViewEntry): ClipLoopEntry {
  const loopCount = clip.loopCount ?? null
  const loopMode = clip.loopMode ?? ''
  let note = '有限片段：可参与叠化与参数过渡'
  if (clip.infinite) {
    note = '无限循环片段：不扩展主时间轴区间，不参与叠化与参数过渡'
  } else if (clip.loop) {
    note = `片段内循环 ${loopMode.length > 0 ? loopMode : '（模式未声明）'}：只影响片段内部时间，不扩展主时间轴区间`
  }
  return {
    trackId: track.trackId,
    trackName: track.name.length > 0 ? track.name : track.type,
    clipKey: clip.clipKey,
    label: clip.label,
    loop: clip.loop,
    loopCount,
    loopMode,
    infinite: clip.infinite,
    participatesInTransition: !clip.infinite && !clip.loop,
    note,
  }
}

/** 读片段在某局部时间的不透明度帧值（容差内；只用于摘要显示）。 */
function opacityAt(frames: readonly { time: number; value: unknown }[], time: number): number | null {
  for (const frame of frames) {
    if (Math.abs(frame.time - time) <= 1e-6 && typeof frame.value === 'number' && Number.isFinite(frame.value)) {
      return frame.value
    }
  }
  return null
}

/** 交界摘要（叠化重叠区 + 参数过渡声明 + 共存遮蔽）。 */
function boundaryEntries(boundaries: readonly TransitionBoundary[]): BoundaryEntry[] {
  return boundaries.map((boundary) => {
    const end = boundary.b.infinite ? boundary.b.start : boundary.b.duration
    const from = opacityAt(boundary.b.opacityFrames, 0)
    const to = opacityAt(boundary.b.opacityFrames, end)
    return {
      id: boundary.id,
      trackName: boundary.trackName.length > 0 ? boundary.trackName : CAMERA_TRACK_TYPE,
      aLabel: boundary.a.label,
      bLabel: boundary.b.label,
      crossfadeOverlapStart: boundary.layout.overlapStart,
      crossfadeOverlapEnd: boundary.layout.overlapEnd,
      crossfadeOverlapDuration: boundary.layout.overlapDuration,
      crossfadeEndpoints: from === null || to === null ? null : { from, to },
      crossfadeIdentified: boundary.crossfade.identified,
      paramType: boundary.param.type,
      paramWindowStart: boundary.param.window === null ? null : boundary.param.window.start,
      paramWindowEnd: boundary.param.window === null ? null : boundary.param.window.end,
      paramWindowWidth: boundary.param.window === null ? 0 : boundary.param.window.width,
      paramInterrupt: boundary.param.interrupt,
      coexistCoverage: boundary.coexist.coverage,
      state: boundary.state,
    }
  })
}

/** 由字段组合生成诊断提示（警告不阻止保存）。 */
function diagnostics(meta: ContinuityMeta, clipLoops: readonly ClipLoopEntry[]): TransitionIssue[] {
  const issues: TransitionIssue[] = []
  if (meta.holdAtEnd && !meta.skippable) {
    issues.push({
      severity: 'warning',
      code: 'continuity.deadlock',
      message: '末尾保持为开且不可跳过：自然结束与跳过都被拒绝，只剩系统停止与强制退出',
    })
  }
  if (meta.playMode === 'exclusive' && !meta.interruptible) {
    issues.push({
      severity: 'warning',
      code: 'continuity.exclusive-sticky',
      message: '独占且不可打断：本脚本播放期间其它脚本只能排队，且它本身不会被顶掉',
    })
  }
  if (!meta.interruptible && meta.playMode !== 'exclusive') {
    issues.push({
      severity: 'warning',
      code: 'continuity.parallel-sticky',
      message: '平行但不可打断：不会被顶掉，也不会让别人让位，可能长期占着播放',
    })
  }
  if (meta.playMode === 'interruptible' && !meta.interruptible) {
    issues.push({
      severity: 'info',
      code: 'continuity.mode-conflict',
      message: 'play_mode = interruptible 表示别的脚本到达时可以让位；interruptible = 关 表示同脚本再触发时进队列，两者作用不同',
    })
  }
  if (meta.macroLoop) {
    issues.push({
      severity: 'info',
      code: 'continuity.macro-loop',
      message: meta.macroLoopCount < 0
        ? `宏循环无限（圈数 ${meta.macroLoopCount}）：按整份脚本折返，折返时 CAMERA 过渡状态复位`
        : `宏循环 ${meta.macroLoopCount} 圈（${MACRO_LOOP_MODE_LABELS[meta.macroLoopMode]}）：按整份脚本折返，达到圈数后按自然结束处理`,
    })
  }
  if (meta.skipVoteRatio === null) {
    issues.push({
      severity: 'info',
      code: 'continuity.skip-vote',
      message: '未声明跳过投票比例：跳过请求按可跳过直接生效，不收集投票',
    })
  }
  for (const entry of clipLoops) {
    if (entry.infinite) {
      issues.push({
        severity: 'info',
        code: 'continuity.clip-loop-infinite',
        message: `片段「${entry.label}」无限循环：不扩展主时间轴区间，也不参与叠化与参数过渡`,
        clipKey: entry.clipKey,
      })
    }
  }
  return issues
}

/** 规则推导：把字段映射成到达裁决与门禁。 */
export function buildContinuityView(input: {
  meta: JsonObject | null
  tracks: readonly TrackViewEntry[]
  transitions: TransitionDocumentView
}): ContinuityView {
  const meta = readContinuityMeta(input.meta)
  const clipLoops = clipLoopEntries(input.tracks)
  const boundaries = boundaryEntries(input.transitions.boundaries)
  const issues = [...input.transitions.boundaries.flatMap((boundary) => boundary.issues), ...diagnostics(meta, clipLoops)]
  return {
    meta,
    sameScript: sameScriptRule(meta),
    crossScript: crossScriptRules(),
    queue: queueRule(meta),
    gates: exitGates(meta),
    clipLoops,
    boundaries,
    issues: sortContinuityIssues(issues),
    macroLoopText: meta.macroLoop
      ? '宏循环按整份脚本折返，不按单个片段折返；折返时 CAMERA 轨道复位过渡状态，上一圈的混合中间态不会带进新一圈'
      : '宏循环未开启：脚本播完即按末尾保持与自然结束的规则处理',
    clipLoopText: '片段循环只影响片段内部时间，不扩展主时间轴上的片段区间；lane 视图仍按片段起止时间判定活跃',
  }
}

/** 提示排序：错误 → 警告 → 信息。 */
export function sortContinuityIssues(issues: readonly TransitionIssue[]): TransitionIssue[] {
  const rank: Record<TransitionIssue['severity'], number> = { error: 0, warning: 1, info: 2 }
  return [...issues].sort((left, right) => {
    const bySeverity = rank[left.severity] - rank[right.severity]
    if (bySeverity !== 0) {
      return bySeverity
    }
    return left.code.localeCompare(right.code)
  })
}
