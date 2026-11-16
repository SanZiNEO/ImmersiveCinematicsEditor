/**
 * 片段结构读取（03-01 / 03-02）：内联片段与独立片段共用同一 `ClipShape`，差异只在键白名单与必填项。
 *
 * 对齐运行时：
 * - 内联片段（`timeline.tracks[].clips[]`）：`start_time` 必填，禁止 `track`；
 * - 独立片段（顶层 `clips[]`）：禁止 `start_time`，`track` 必填，`objects` 必须非空；
 * - 两者：`duration` 必填且 `!= 0`；`loop` / `loop_count` / `loop_mode` 类型与取值；`id` 形态；
 * - `objects` 的每条路径必须是 02 目录登记的 `ObjectDef`（未知轨道只做形态检查，不解释字段）；
 * - `exit` 结构按 `ClipExitPolicyParser`（target 的引用可解析性归引用完整性检查）。
 */
import type { CatalogIndex } from '../schema/index.ts'
import { describe, isFiniteNumber, isJsonObject, isJsonPrimitive, memberPath } from './json.ts'
import {
  CLIP_ID_PATTERN,
  EXIT_KEYS,
  EXIT_KIND_NAMES,
  firstUnknownKey,
  LOOP_MODES,
  clipKeys,

} from './keys.ts'
import { readAnimObject, readAnimObjectShape } from './object.ts'
import { isValidObjectPath } from './path.ts'
import { pushProblem } from './problems.ts'
import type { AnimObjectShape, JsonObject, JsonValue, LocalProblem } from './types.ts'

/** 片段读取上下文。 */
export interface ClipReadContext {
  /** 内联片段 = `timeline.tracks[].clips[]`；独立片段 = 顶层 `clips[]`。 */
  inline: boolean
  jsonPath: string
  trackType: string
  catalog: CatalogIndex
}

/** 片段的文档侧形状（只保留作者显式声明的值）。 */
export interface ClipShape {
  startTime?: number
  duration: number
  id?: string
  track?: string
  loop: boolean
  loopCount: number
  loopMode: string
  objects: Record<string, AnimObjectShape>
  exit?: JsonObject
}

export interface ClipReadResult {
  /** 是否存在 parser 级（block）问题。 */
  ok: boolean
  clip: ClipShape
  problems: LocalProblem[]
}

/** 读 `exit` 对象（片段默认出口 / 绑定入口覆盖共用同一结构）。 */
export function readExit(
  raw: JsonValue,
  jsonPath: string,
): { ok: boolean; exit?: JsonObject; problems: LocalProblem[] } {
  const problems: LocalProblem[] = []
  if (!isJsonObject(raw)) {
    pushProblem(problems, 'block', 'L31', '需要对象（出口策略）', { jsonPath })
    return { ok: false, problems }
  }
  const unknown = firstUnknownKey(raw, EXIT_KEYS)
  if (unknown !== undefined) {
    pushProblem(problems, 'block', 'L31', `未知键（可用: ${EXIT_KEYS.join(' / ')}）`, {
      jsonPath: memberPath(jsonPath, unknown),
    })
  }
  const kind = raw.on_complete
  if (typeof kind !== 'string') {
    pushProblem(problems, 'block', 'L31', 'on_complete 缺失或不是字符串', {
      jsonPath: memberPath(jsonPath, 'on_complete'),
    })
    return { ok: false, exit: raw, problems }
  }
  if (!EXIT_KIND_NAMES.includes(kind)) {
    pushProblem(problems, 'block', 'L31', `未知出口类型: ${kind}（可选: ${EXIT_KIND_NAMES.join(' / ')}）`, {
      jsonPath: memberPath(jsonPath, 'on_complete'),
    })
    return { ok: false, exit: raw, problems }
  }
  if (kind === 'goto') {
    const target = raw.target
    if (typeof target !== 'string' || target.length === 0) {
      pushProblem(problems, 'block', 'L31', 'goto 必须有非空 target（目标片段 id）', {
        jsonPath: memberPath(jsonPath, 'target'),
      })
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'entry_time')) {
      const entry = raw.entry_time
      if (!isFiniteNumber(entry) || entry < 0) {
        pushProblem(problems, 'block', 'L31', `entry_time 需要 >= 0 的有限数字，实际: ${describe(entry)}`, {
          jsonPath: memberPath(jsonPath, 'entry_time'),
        })
      }
    }
  } else {
    if (Object.prototype.hasOwnProperty.call(raw, 'target')) {
      pushProblem(problems, 'block', 'L31', 'target 不允许（只有 goto 需要 target）', {
        jsonPath: memberPath(jsonPath, 'target'),
      })
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'entry_time')) {
      pushProblem(problems, 'block', 'L31', 'entry_time 不允许（只有 goto 需要 entry_time）', {
        jsonPath: memberPath(jsonPath, 'entry_time'),
      })
    }
  }
  return { ok: !problems.some((item) => item.severity === 'block'), exit: raw, problems }
}

/**
 * 读一个片段。
 *
 * `objects` 的每条路径：轨道类型已知 → 必须命中 `catalog.objectDef(type, path)`（未命中 = parser 拒绝）；
 * 轨道类型未知（第三方 `modid:`）→ 只读形态，不解释字段、不报「未知字段」。
 */
export function readClip(raw: JsonValue, ctx: ClipReadContext): ClipReadResult {
  const problems: LocalProblem[] = []
  const clip: ClipShape = {
    duration: 0,
    loop: false,
    loopCount: -1,
    loopMode: 'repeat',
    objects: {},
  }

  if (!isJsonObject(raw)) {
    pushProblem(problems, 'block', ctx.inline ? 'L06' : 'L09', '需要对象（片段）', { jsonPath: ctx.jsonPath })
    return { ok: false, clip, problems }
  }

  const allowed = clipKeys(ctx.inline)
  const unknown = firstUnknownKey(raw, allowed)
  if (unknown !== undefined) {
    pushProblem(problems, 'block', 'L10', `片段键不允许: ${unknown}（可用: ${allowed.join(' / ')}）`, {
      jsonPath: memberPath(ctx.jsonPath, unknown),
    })
  }

  if (ctx.inline) {
    if (!Object.prototype.hasOwnProperty.call(raw, 'start_time')) {
      pushProblem(problems, 'block', 'L06', '内联片段缺少必填字段 start_time', {
        jsonPath: memberPath(ctx.jsonPath, 'start_time'),
      })
    } else if (!isFiniteNumber(raw.start_time)) {
      pushProblem(problems, 'block', 'L06', `start_time 需要有限数字，实际: ${describe(raw.start_time)}`, {
        jsonPath: memberPath(ctx.jsonPath, 'start_time'),
      })
    } else {
      clip.startTime = raw.start_time
    }
  } else {
    if (Object.prototype.hasOwnProperty.call(raw, 'start_time')) {
      pushProblem(problems, 'block', 'L09', '独立片段不能有 start_time（没有默认放置）', {
        jsonPath: memberPath(ctx.jsonPath, 'start_time'),
      })
    }
    const track = raw.track
    if (typeof track !== 'string' || track.length === 0) {
      pushProblem(problems, 'block', 'L09', '独立片段缺少必填字段 track（轨道类型）', {
        jsonPath: memberPath(ctx.jsonPath, 'track'),
      })
    } else {
      clip.track = track
    }
  }

  if (!Object.prototype.hasOwnProperty.call(raw, 'duration')) {
    pushProblem(problems, 'block', ctx.inline ? 'L06' : 'L09', '缺少必填字段 duration', {
      jsonPath: memberPath(ctx.jsonPath, 'duration'),
    })
  } else if (!isFiniteNumber(raw.duration)) {
    pushProblem(problems, 'block', ctx.inline ? 'L06' : 'L09', `duration 需要有限数字，实际: ${describe(raw.duration)}`, {
      jsonPath: memberPath(ctx.jsonPath, 'duration'),
    })
  } else if (raw.duration === 0) {
    pushProblem(problems, 'block', ctx.inline ? 'L06' : 'L09', 'duration 不允许为 0（正数=有限时长，负数=无限时长）', {
      jsonPath: memberPath(ctx.jsonPath, 'duration'),
    })
  } else {
    clip.duration = raw.duration
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'loop')) {
    if (typeof raw.loop !== 'boolean') {
      pushProblem(problems, 'block', 'L07', `loop 需要布尔值，实际: ${describe(raw.loop)}`, {
        jsonPath: memberPath(ctx.jsonPath, 'loop'),
      })
    } else {
      clip.loop = raw.loop
    }
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'loop_count')) {
    const count = raw.loop_count
    if (!isFiniteNumber(count) || !Number.isInteger(count)) {
      pushProblem(problems, 'block', 'L07', `loop_count 需要整数，实际: ${describe(count)}`, {
        jsonPath: memberPath(ctx.jsonPath, 'loop_count'),
      })
    } else if (count === 0) {
      pushProblem(problems, 'error', 'L07', 'loop_count 不允许为 0（-1=无限循环，正整数=循环次数）', {
        jsonPath: memberPath(ctx.jsonPath, 'loop_count'),
      })
      clip.loopCount = count
    } else if (count < -1) {
      pushProblem(problems, 'error', 'L07', 'loop_count 不能小于 -1（-1=无限循环，正整数=循环次数）', {
        jsonPath: memberPath(ctx.jsonPath, 'loop_count'),
      })
      clip.loopCount = count
    } else {
      clip.loopCount = count
    }
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'loop_mode')) {
    const mode = raw.loop_mode
    if (typeof mode !== 'string' || !LOOP_MODES.includes(mode)) {
      pushProblem(problems, 'block', 'L07', `loop_mode 需要 repeat / pingpong，实际: ${describe(mode)}`, {
        jsonPath: memberPath(ctx.jsonPath, 'loop_mode'),
      })
    } else {
      clip.loopMode = mode
    }
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'id')) {
    const id = raw.id
    if (typeof id !== 'string' || !CLIP_ID_PATTERN.test(id)) {
      pushProblem(problems, 'block', 'L18', `片段 id 不合法: ${describe(id)}（需匹配 ${CLIP_ID_PATTERN.source}）`, {
        jsonPath: memberPath(ctx.jsonPath, 'id'),
      })
    } else {
      clip.id = id
    }
  }

  const objectsRaw = raw.objects
  if (!isJsonObject(objectsRaw)) {
    pushProblem(problems, 'block', ctx.inline ? 'L11' : 'L09', 'objects 必须是对象（点分路径 → 属性对象）', {
      jsonPath: memberPath(ctx.jsonPath, 'objects'),
    })
  } else {
    if (!ctx.inline && Object.keys(objectsRaw).length === 0) {
      pushProblem(problems, 'block', 'L09', '独立片段 objects 必须非空', {
        jsonPath: memberPath(ctx.jsonPath, 'objects'),
      })
    }
    const trackKnown = ctx.catalog.track(ctx.trackType) !== undefined
    for (const [path, propertyRaw] of Object.entries(objectsRaw)) {
      const propertyPath = memberPath(memberPath(ctx.jsonPath, 'objects'), path)
      if (!isValidObjectPath(path)) {
        pushProblem(problems, 'block', 'L34', `非法属性路径: ${path}（段名需匹配 [a-z][a-z0-9_]*，以 . 分隔）`, {
          jsonPath: propertyPath,
          objectPath: path,
        })
        continue
      }
      const def = trackKnown ? ctx.catalog.objectDef(ctx.trackType, path) : undefined
      if (trackKnown && def === undefined) {
        pushProblem(problems, 'block', 'L34', `未登记的对象路径: ${path}（轨道 ${ctx.trackType}）`, {
          jsonPath: propertyPath,
          objectPath: path,
        })
        continue
      }
      const context = { jsonPath: propertyPath, duration: clip.duration, infinite: clip.duration < 0 }
      const result = def === undefined
        ? readAnimObjectShape(propertyRaw, context)
        : readAnimObject(def, propertyRaw, context)
      for (const item of result.problems) {
        problems.push({ ...item, objectPath: path })
      }
      clip.objects[path] = result.object
    }
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'exit')) {
    const exitResult = readExit(raw.exit, memberPath(ctx.jsonPath, 'exit'))
    for (const item of exitResult.problems) {
      problems.push(item)
    }
    if (exitResult.exit !== undefined) {
      clip.exit = exitResult.exit
    }
  }

  const ok = !problems.some((item) => item.severity === 'block')
  return { ok, clip, problems }
}

/** 片段是否为新格式（`objects` 非空对象）。 */
export function hasObjects(clip: JsonValue): boolean {
  return isJsonObject(clip) && isJsonObject(clip.objects) && Object.keys(clip.objects).length > 0
}

/** 片段 id（存在且为字符串时）；未命名片段返回 `undefined`。 */
export function clipIdOf(clip: JsonValue): string | undefined {
  return isJsonObject(clip) && isJsonPrimitive(clip.id) && typeof clip.id === 'string' && clip.id.length > 0
    ? clip.id
    : undefined
}
