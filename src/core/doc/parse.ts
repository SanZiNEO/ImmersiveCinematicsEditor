/**
 * `parseDoc`：把 `script.load` 返回的 JSON 包装成编辑器的 `ScriptDoc`（03-01）。
 *
 * 纯函数，**不改输入**：包装的是同一棵树，但只读地校验；调用方负责传入自己的副本。
 * 打开门槛只有两条（与运行时一致）：根必须是对象、`meta` / `timeline` 必须是对象。
 * `meta` / `timeline` 的键白名单在打开时就报阻断错误（运行时 `rejectUnknownFields` 直接抛），
 * 但**不删键**——原文件保持不变，由作者修正。
 *
 * 根对象没有白名单：未知根键保留 + `info`（运行时忽略，删了会毁掉作者的外部工具数据）。
 */
import { cloneJson, isJsonObject, memberPath } from './json.ts'
import { firstUnknownKey, ROOT_KEYS, TIMELINE_KEYS } from './keys.ts'
import { pushProblem } from './problems.ts'
import type { DocIssue, JsonValue, LocalProblem, ScriptDoc } from './types.ts'

export interface ParseDocOptions {
  /** `meta` 键集合（只从 02 目录取：21 个 schema 字段 + triggers + trigger_poll_interval）。 */
  metaKeys: readonly string[]
}

export type ParseDocResult =
  | { ok: true; doc: ScriptDoc; issues: DocIssue[] }
  | { ok: false; issues: DocIssue[] }

/** 把本地问题转成 `DocIssue`（parse 阶段还没有 clipKey）。 */
function toIssues(problems: readonly LocalProblem[]): DocIssue[] {
  return problems.map((problem) => ({ ...problem, source: 'local' }))
}

/**
 * 解析并包装脚本文档。
 *
 * - 失败（根不是对象 / meta、timeline 缺失）→ `ok:false`，调用方阻断打开；
 * - 成功 → 返回 `doc` 与「打开即可见」的 issue（meta/timeline 未知键为 `block`，根未知键为 `info`）。
 */
export function parseDoc(input: JsonValue, options: ParseDocOptions): ParseDocResult {
  const problems: LocalProblem[] = []

  if (!isJsonObject(input)) {
    pushProblem(problems, 'block', 'L01', '根元素必须是 JSON 对象', { jsonPath: '<root>' })
    return { ok: false, issues: toIssues(problems) }
  }

  // 深拷贝：返回的文档与输入隔离，编辑 doc 不会改写调用方持有的 JSON（打开只读不改写）。
  const root = cloneJson(input)
  const metaRaw = root.meta
  if (!isJsonObject(metaRaw)) {
    pushProblem(problems, 'block', 'L02', 'meta 缺失或不是对象（需要 id / name / author）', {
      jsonPath: 'meta',
    })
  }

  const timelineRaw = root.timeline
  if (!isJsonObject(timelineRaw)) {
    pushProblem(problems, 'block', 'L05', 'timeline 缺失或不是对象', { jsonPath: 'timeline' })
  }

  if (problems.length > 0) {
    return { ok: false, issues: toIssues(problems) }
  }

  const meta = metaRaw as { [key: string]: JsonValue }
  const timeline = timelineRaw as { [key: string]: JsonValue }

  const unknownMeta = firstUnknownKey(meta, options.metaKeys)
  if (unknownMeta !== undefined) {
    pushProblem(problems, 'block', 'L02', `未知字段（可用: ${options.metaKeys.join(' / ')}）`, {
      jsonPath: memberPath('meta', unknownMeta),
    })
  }

  const unknownTimeline = firstUnknownKey(timeline, TIMELINE_KEYS)
  if (unknownTimeline !== undefined) {
    pushProblem(problems, 'block', 'L05', `未知字段（可用: ${TIMELINE_KEYS.join(' / ')}）`, {
      jsonPath: memberPath('timeline', unknownTimeline),
    })
  }

  for (const key of Object.keys(root)) {
    if (ROOT_KEYS.includes(key)) {
      continue
    }
    pushProblem(problems, 'info', 'L34', `根键 ${key} 运行时忽略；编辑器保留原样（不删、不改）`, {
      jsonPath: key,
    })
  }

  if (problems.some((problem) => problem.severity === 'block')) {
    return { ok: false, issues: toIssues(problems) }
  }

  const doc: ScriptDoc = {
    root,
    meta,
    timeline,
    authoring: {},
    clipAuthoring: {},
  }
  return { ok: true, doc, issues: toIssues(problems) }
}
