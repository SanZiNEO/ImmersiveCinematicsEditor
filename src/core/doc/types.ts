/**
 * 03 编辑器脚本文档模型的共享类型。
 *
 * 事实基准：主模组 `ScriptParser` / `ObjectParser` / `SampledProperty` / `ScriptValidator`。
 * 字段定义只从 02 字段目录（`CatalogIndex` / `FieldEntry`）读取；本模块不复制字段表。
 */

/** JSON 标量。 */
export type JsonPrimitive = string | number | boolean | null

/** JSON 值（与 `JSON.parse` 产物同域；不含 `undefined`）。 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** JSON 对象。 */
export type JsonObject = { [key: string]: JsonValue }

/** JSON 数组。 */
export type JsonArray = JsonValue[]

/** 校验级别（03-06）：block = parser 会拒绝；error = parser 接受但 validator 报错；warn = 警告级；info = 编辑器提示。 */
export const SEVERITIES = ['block', 'error', 'warn', 'info'] as const

export type Severity = (typeof SEVERITIES)[number]

/** 一条文档 issue；定位一律用 `jsonPath` + 可选的片段 / 对象 / 关键帧三元组。 */
export interface DocIssue {
  /** L01–L34 本地结构检查编号；13 轮补充 L91（同轨字幕重叠）、L92（资源存在性）；或 `E_*` / `S_*` 的其它来源。 */
  code: string
  severity: Severity
  message: string
  /** 文档内 JSON 路径，如 `timeline.tracks[0].clips[1].objects.yaw.keyframes[0].time`。 */
  jsonPath: string
  clipKey?: string
  objectPath?: string
  keyframeTime?: number
  /** `local` = 本地结构检查；`server` = `script.validate` 的 issue。 */
  source: 'local' | 'server'
  /** 服务端 issue 在断连后保留时标 `true`（03-06）。 */
  stale?: boolean
}

/** 结构读取过程中的问题（未绑定 clipKey / 未定 source），由调用方包装成 `DocIssue`。 */
export interface LocalProblem {
  code: string
  severity: Severity
  message: string
  jsonPath: string
  objectPath?: string
  keyframeTime?: number
}

/** 一个属性的文档形状（03-02）：只允许 `value` / `keyframes`。 */
export interface AnimObjectShape {
  /** 键存在 = 作者显式声明（`undefined` 不是合法 JSON 值，用键是否存在表达）。 */
  value?: JsonValue
  keyframes?: ObjectKeyframe[]
}

/** 关键帧：一帧只带 `time` + `value`，属于一个属性。 */
export interface ObjectKeyframe {
  time: number
  value: JsonValue
}

/** 仅内存的编辑态（可含 `undefined`，绝不写盘）。 */
export interface AuthoringState {
  [key: string]: unknown
}

/**
 * 脚本文档。
 *
 * `root` 是唯一事实来源（保存 / 推送都从它派生）；`meta` / `timeline` 是指向 root 内对象的引用。
 * 编辑器不持有字段副本，也不持有派生缓存（派生在 store 的 `derived` 层）。
 */
export interface ScriptDoc {
  root: JsonObject
  meta: JsonObject
  timeline: JsonObject
  /** 仅内存；不写盘。 */
  authoring: AuthoringState
  /** clipKey → 仅内存状态（展开、缓动标记等）；不写盘。 */
  clipAuthoring: Record<string, AuthoringState>
}

/** 选择域（同一时刻最多一个主域，03-03）。 */
export type SelectionDomain = 'none' | 'clip' | 'object' | 'keyframe' | 'path' | 'rule' | 'binding'

/**
 * 选择：绝不用数组下标。
 *
 * 不变式：`object` / `keyframe` 域必须带 `clipKey`；`keyframe` 域再加 `keyframeTime`；
 * `path` / `rule` / `binding` 域各自独立。
 */
export interface Selection {
  domain: SelectionDomain
  clipKey?: string
  objectPath?: string
  /** 关键帧定位值（片段局部秒），不是下标。 */
  keyframeTime?: number
  pathId?: string
  ruleId?: string
  bindingId?: string
}

/** 空选择。 */
export const EMPTY_SELECTION: Selection = { domain: 'none' }

/** 轨道视图状态（session 层，不写盘）。 */
export interface TrackViewState {
  visible: boolean
  locked: boolean
  muted: boolean
}

/** session 层：选择、播放头、缩放、轨道可见 / 锁定 / 静音、marker、A-B 循环、目录钉住。 */
export interface SessionState {
  selection: Selection
  /**
   * 会话批选（04-05 `PanelContext.clipKeys`）：多选片段键，按选择顺序去重。
   * `open` 清空，`select` / `selectMany` 维护；不写盘。
   */
  clipKeys: string[]
  /**
   * 上次选择因目标失效被修复时保留的记录（04-05 `invalid` 态）：
   * 片段被删除 / 撤销后选择器退回，面板需要显示失效原因与撤销入口。
   */
  selectionInvalid: { reason: string; previous: Selection } | null
  playhead: number
  pxPerSecond: number
  /** UI 的 A-B 循环；与 `doc.timeline.loop_start/loop_end` 不得互写。 */
  loopRange: { start: number; end: number } | null
  /** UI 预览范围（session，不写文档；05-12）。 */
  previewRange: { start: number; end: number } | null
  markers: number[]
  trackView: Record<string, TrackViewState>
  /** 文档打开时钉住的目录指纹（03-08）；不写进脚本。 */
  catalogHash: string | null
  /** 当前文件路径；未落盘的新建文档为 `null` 或服务端给出的临时路径。 */
  currentPath: string | null
}

/** derived 层：可重算的派生结果。 */
export interface DerivedState {
  /** 有限内容末端（秒）；内容无限时 `null`。 */
  contentEnd: number | null
  infinite: boolean
  localIssues: DocIssue[]
  serverIssues: DocIssue[]
  /** 断连后保留的上一批 issue 标为过期（03-06）。 */
  serverIssuesStale: boolean
  /** 绑定目录指纹（03-08）。 */
  catalogHash: string | null
  /** 目录漂移导致的 issue（重绑后仍未通过）。 */
  catalogIssues: DocIssue[]
  /** 预览推送状态。 */
  previewStale: boolean
  /** 资源存在性检查状态；未提供资源根 / 解析器时为未检查（不判定缺失）。 */
  resourceCheck: ResourceCheckState
}

/** 资源存在性检查的派生状态（不含 issue 本体，issue 进 `localIssues`）。 */
export interface ResourceCheckState {
  /** 是否真正做了存在性检查；`false` = 已跳过。 */
  checked: boolean
  /** 跳过时说明未检查的原因；检查时为空。 */
  skippedReason?: string
}

/** transport 层：连接、请求计数、预览帧。 */
export interface TransportState {
  connected: boolean
  requestId: number
  pending: number
  lastError: string | null
  lastPreviewFrameAt: number | null
}

/** 新建四层状态。 */
export interface EditorLayers {
  session: SessionState
  derived: DerivedState
  transport: TransportState
}

/** 创建初始 session 状态。 */
export function createSessionState(): SessionState {
  return {
    selection: { ...EMPTY_SELECTION },
    clipKeys: [],
    selectionInvalid: null,
    playhead: 0,
    pxPerSecond: 40,
    loopRange: null,
    previewRange: null,
    markers: [],
    trackView: {},
    catalogHash: null,
    currentPath: null,
  }
}

/** 创建初始 derived 状态。 */
export function createDerivedState(): DerivedState {
  return {
    contentEnd: 0,
    infinite: false,
    localIssues: [],
    serverIssues: [],
    serverIssuesStale: false,
    catalogHash: null,
    catalogIssues: [],
    previewStale: false,
    resourceCheck: { checked: false, skippedReason: '未提供资源根，资源存在性未检查（不判定缺失）。' },
  }
}

/** 创建初始 transport 状态。 */
export function createTransportState(): TransportState {
  return {
    connected: false,
    requestId: 0,
    pending: 0,
    lastError: null,
    lastPreviewFrameAt: null,
  }
}

/** 是否存在阻断级 issue。 */
export function hasBlockingIssues(issues: readonly DocIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'block')
}
