/**
 * 05 自检：主轴几何 / 片段编辑纯函数 / 04-05 文档命令扩展。
 *
 * 运行：`node --experimental-strip-types src/core/timeline/verify.ts`
 * 输出：每条断言一行 `ok   <描述>` / `FAIL <描述>：<实际值>`，最后 `summary ok=<n> fail=<n>`。
 * 任一失败把 `process.exitCode` 置 1。
 *
 * 覆盖：
 * - geometry：缩放互逆、有限/无限显示范围、吸附优先级、刻度档、适配、命中；
 * - clipEdit：分割（含关键帧归组 / id / 无限拒绝）、顺排、波纹位移；
 * - commands：移动/跨轨/裁切/分割/删除/波纹删除/循环/顺排/粘贴、轨道增删改排序、
 *   trigger requires 增改删（字符串形状 / 空数组删键 / 自定义只读）、setConditions、setFields、
 *   引用拒绝与撤销一次回退。
 */
import { buildCatalog, indexCatalog } from '../schema/index.ts'
import type { CatalogIndex } from '../schema/index.ts'
import { eachClip } from '../doc/identity.ts'
import { metaKeys } from '../doc/keys.ts'
import { parseDoc } from '../doc/parse.ts'
import { DocStore } from '../doc/store.ts'
import type { JsonObject, JsonValue } from '../doc/types.ts'
import { compactStarts, rippleShift, splitClipObject } from './clipEdit.ts'
import {
  DEFAULT_PPS,
  MAX_PPS,
  MIN_PPS,
  SNAP_THRESHOLD_PX,
  chooseRulerInterval,
  clampPxPerSecond,
  clipWindowEnd,
  computeDisplayRange,
  fitPxPerSecond,
  hitTest,
  isClipInfinite,
  rulerTicks,
  screenXToTime,
  snapTime,
  timeToScreenX,
} from './geometry.ts'
import type { DisplayRange, SnapContext, TimelineScale } from './geometry.ts'

let ok = 0
let fail = 0

/** 断言实际值压成一行。 */
function format(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return value.message
  }
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 300 ? `${text.slice(0, 300)}…` : text
  } catch {
    return String(value)
  }
}

/** 记一条断言。 */
function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  console.log(`FAIL ${label}：${format(actual)}`)
}

/** 近似相等（浮点换算 / 时间计算）。 */
function near(left: number, right: number, epsilon = 1e-9): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= epsilon
}

/** 文档 JSON 对象判断（自检内部用，不额外依赖）。 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const catalog: CatalogIndex = indexCatalog(buildCatalog('0000000000000000000000000000000000000000'))
const metaKeyList = metaKeys(catalog)

/** 最小夹具：两条 CAMERA 轨、AUDIO、ADJUST；触发器覆盖字符串/对象/自定义前置与无 id 触发器。 */
function fixture(): JsonObject {
  return {
    meta: {
      id: 'timeline_verify',
      name: 'Timeline Verify',
      author: '',
      triggers: [
        { id: 't_login', type: 'login', requires: ['other'], repeatable: false, delay: 2 },
        {
          id: 't_loc',
          type: 'location',
          conditions: { dimension: 'overworld', radius: 5 },
          requires: [
            { type: 'script_started', data: { script: 'other' } },
            { type: 'mod_custom', data: { anything: 1 } },
          ],
        },
        { type: 'death' },
      ],
    },
    timeline: {
      tracks: [
        {
          type: 'CAMERA',
          clips: [
            {
              id: 'cam_a',
              start_time: 0,
              duration: 10,
              objects: {
                yaw: {
                  keyframes: [
                    { time: 0, value: 0 },
                    { time: 2, value: 10 },
                    { time: 4, value: 20 },
                    { time: 6, value: 30 },
                    { time: 8, value: 40 },
                  ],
                },
              },
            },
            { id: 'cam_b', start_time: 12, duration: 5, objects: {} },
            { id: 'cam_c', start_time: 20, duration: 5, objects: {} },
          ],
        },
        { type: 'CAMERA', clips: [] },
        { type: 'AUDIO', clips: [{ id: 'aud_a', start_time: 0, duration: 3, objects: {} }] },
        { type: 'ADJUST', clips: [] },
      ],
    },
  }
}

/** 在标准夹具上改一处（每个用例独立副本）。 */
function fixtureWith(mutate: (root: JsonObject) => void): JsonObject {
  const root = fixture()
  mutate(root)
  return root
}

/** 打开一份夹具；解析失败直接抛错（夹具问题应让自检崩掉，而不是静默跳过）。 */
function openStore(json: JsonObject = fixture()): DocStore {
  const parsed = parseDoc(json, { metaKeys: metaKeyList })
  if (!parsed.ok) {
    throw new Error(`夹具无法解析：${parsed.issues.map((issue) => issue.message).join('；')}`)
  }
  const store = new DocStore({ catalog, metaKeys: metaKeyList })
  store.open(parsed.doc, 'timeline-verify.json')
  return store
}

/** 当前文档片段对象集合（排除撤销/失败提交后注册表里残留的旧对象）。 */
function currentClipSet(store: DocStore): Set<JsonObject> {
  const result = new Set<JsonObject>()
  const doc = store.doc
  if (doc !== null) {
    eachClip(doc, (clip) => {
      result.add(clip)
    })
  }
  return result
}

/** 按片段 id 找当前文档里的句柄（只认当前文档对象，不认注册表残影）。 */
function handleById(store: DocStore, id: string): { key: string; clip: JsonObject } {
  const live = currentClipSet(store)
  const handle = store.registry.handles().find((item) => item.id === id && live.has(item.clip))
  if (handle === undefined) {
    throw new Error(`夹具缺少片段 id=${id}`)
  }
  return { key: handle.key, clip: handle.clip }
}

/** 按 id 取当前文档片段对象。 */
function clipById(store: DocStore, id: string): JsonObject {
  return handleById(store, id).clip
}

/** 取某条轨道当前的 clips 数组。 */
function trackClips(store: DocStore, trackIndex: number): JsonValue[] {
  const tracks = store.doc?.timeline.tracks
  if (!Array.isArray(tracks)) {
    return []
  }
  const track = tracks[trackIndex]
  if (!isJsonObject(track) || !Array.isArray(track.clips)) {
    return []
  }
  return track.clips
}

/** 当前文档里真实片段键集合（排除已删除但尚未被注册表回收的旧键）。 */
function liveKeys(store: DocStore): Set<string> {
  const result = new Set<string>()
  const doc = store.doc
  if (doc === null) {
    return result
  }
  eachClip(doc, (clip) => {
    const key = store.registry.keyOf(clip)
    if (key !== undefined) {
      result.add(key)
    }
  })
  return result
}

/** 提交并断言成功。 */
function commitOk(store: DocStore, command: Parameters<DocStore['commit']>[0], label: string): boolean {
  const result = store.commit(command)
  check(label, result.ok, result.error)
  return result.ok
}

/** 提交并断言失败。 */
function commitFails(store: DocStore, command: Parameters<DocStore['commit']>[0], label: string): boolean {
  const result = store.commit(command)
  check(label, !result.ok, result.error ?? '命令意外成功')
  return !result.ok
}

// ── geometry：缩放与基础常量 ────────────────────────────────────────────────
check('geometry：MIN_PPS / MAX_PPS / DEFAULT_PPS / SNAP_THRESHOLD_PX 常量', MIN_PPS === 5 && MAX_PPS === 500
  && DEFAULT_PPS === 80 && SNAP_THRESHOLD_PX === 8)
check('geometry：clamp 下限', clampPxPerSecond(0) === MIN_PPS)
check('geometry：clamp 上限', clampPxPerSecond(9999) === MAX_PPS)
check('geometry：clamp 非法值回默认', clampPxPerSecond(Number.NaN) === DEFAULT_PPS)
for (const pps of [5, 40, 80, 500]) {
  const scale: TimelineScale = { pxPerSecond: pps, scrollLeft: 123.5, viewportWidth: 800 }
  const time = 7.25
  check(`geometry：缩放 ${pps} 屏幕↔时间互逆`, near(screenXToTime(timeToScreenX(time, scale), scale), time))
}
check('geometry：timeToScreenX 不产生 NaN', Number.isFinite(timeToScreenX(Number.NaN, {
  pxPerSecond: 80,
  scrollLeft: Number.NaN,
  viewportWidth: 0,
})))

// ── geometry：窗口末端 / 无限判定 ─────────────────────────────────────────
check('geometry：loop_count=3 的窗口末端', clipWindowEnd({ start: 4, duration: 2, loop: true, loopCount: 3 }) === 10)
check('geometry：不循环的窗口末端', clipWindowEnd({ start: 4, duration: 2 }) === 6)
check('geometry：loop_count=0 按一次计', clipWindowEnd({ start: 4, duration: 2, loop: true, loopCount: 0 }) === 6)
check('geometry：duration<0 是无限', isClipInfinite({ duration: -1 }))
check('geometry：loop_count<0 是无限', isClipInfinite({ duration: 2, loop: true, loopCount: -1 }))
check('geometry：普通循环不是无限', !isClipInfinite({ duration: 2, loop: true, loopCount: 3 }))

// ── geometry：显示范围 ────────────────────────────────────────────────────
{
  const range = computeDisplayRange({
    clips: [{ start: 0, duration: 12.5 }],
    viewportWidth: 800,
    pxPerSecond: 80,
  })
  check('geometry：有限范围 finiteEnd=12.5', range.finiteEnd === 12.5 && !range.infinite)
  check('geometry：有限范围至少 30s + 尾部', near(range.end, 30 + Math.max(120, 400) / 80))
}
{
  const range = computeDisplayRange({
    clips: [{ start: 4, duration: 2, loop: true, loopCount: 3 }],
    viewportWidth: 800,
    pxPerSecond: 80,
  })
  check('geometry：循环片段 finiteEnd 取 10 而不是 6', range.finiteEnd === 10)
}
{
  const range = computeDisplayRange({ clips: [{ start: 0, duration: -1 }], viewportWidth: 800, pxPerSecond: 80 })
  check('geometry：无限片段 → infinite', range.infinite)
  check('geometry：无限片段 → 至少 60s', range.end >= 60)
  check('geometry：无限片段不产生 Infinity/NaN', Number.isFinite(range.end) && range.finiteEnd === null)
  const scrolled = computeDisplayRange({
    clips: [{ start: 0, duration: -1 }],
    viewportWidth: 800,
    pxPerSecond: 80,
    scrollLeft: 10000,
  })
  check('geometry：无限范围随 scrollLeft 延伸', scrolled.end > range.end)
}
{
  const range = computeDisplayRange({ clips: [], viewportWidth: 320, pxPerSecond: 500 })
  check('geometry：空文档有限范围从 30s 起', !range.infinite && range.end >= 30 && Number.isFinite(range.end))
}

// ── geometry：吸附 ─────────────────────────────────────────────────────────
{
  const pps = 80
  const base: SnapContext = {
    enabled: true,
    thresholdPx: SNAP_THRESHOLD_PX,
    playhead: 10,
    clipEdges: [],
    markers: [],
    loopStart: null,
    loopEnd: null,
    previewStart: null,
    previewEnd: null,
    gridInterval: 0,
    pxPerSecond: pps,
  }
  const rawNearPlayhead = 10 + 3 / pps
  const edgeCandidate = 10 + 5 / pps
  check('geometry：播放头优先于片段边界', snapTime(rawNearPlayhead, { ...base, clipEdges: [edgeCandidate] }) === 10)
  check('geometry：Alt 临时关闭吸附', snapTime(rawNearPlayhead, { ...base, altKey: true }) === rawNearPlayhead)
  check('geometry：enabled=false 不吸附', snapTime(rawNearPlayhead, { ...base, enabled: false }) === rawNearPlayhead)
  check('geometry：片段边界吸附', snapTime(5 + 3 / pps, {
    ...base,
    playhead: 100,
    clipEdges: [5],
  }) === 5)
  check('geometry：标记吸附', snapTime(6 + 2 / pps, { ...base, playhead: 100, markers: [6] }) === 6)
  check('geometry：循环端点吸附', snapTime(7 + 2 / pps, { ...base, playhead: 100, loopStart: 7 }) === 7)
  check('geometry：预览端点吸附', snapTime(8 + 2 / pps, { ...base, playhead: 100, previewEnd: 8 }) === 8)
  check('geometry：0 点吸附', snapTime(0 + 3 / pps, { ...base, playhead: 100 }) === 0)
  check('geometry：栅格吸附', snapTime(2.51, { ...base, playhead: 100, gridInterval: 0.5 }) === 2.5)
  check('geometry：无候选不产生假吸附', snapTime(3.14159, { ...base, playhead: 100 }) === 3.14159)
  check('geometry：阈值外不吸附', snapTime(10 + 9 / pps, base) === 10 + 9 / pps)
  check('geometry：同优先级取最近', snapTime(5 + 2 / pps, {
    ...base,
    playhead: 100,
    clipEdges: [5, 5 + 4 / pps],
  }) === 5)
}

// ── geometry：刻度与适配 ───────────────────────────────────────────────────
check('geometry：80px/s 选 1s 刻度', chooseRulerInterval(80) === 1)
check('geometry：5px/s 选 30s 刻度', chooseRulerInterval(5) === 30)
check('geometry：500px/s 选 0.5s 刻度', chooseRulerInterval(500) === 0.5)
{
  const range: DisplayRange = { finiteEnd: 12.5, infinite: false, start: 0, end: 35 }
  const ticks = rulerTicks(range, 80, 800)
  check('geometry：刻度从 0 开始且 0 是主刻度', ticks.length > 0 && ticks[0].time === 0 && ticks[0].major
    && ticks[0].label === '0s')
  const majors = ticks.filter((tick) => tick.major)
  check('geometry：主刻度间隔 1s', majors.length >= 2 && near(majors[1].time - majors[0].time, 1))
  check('geometry：刻度不超出显示末端', ticks.every((tick) => tick.time <= range.end + 1e-9))
  check('geometry：次刻度不带标签', ticks.filter((tick) => !tick.major).every((tick) => tick.label === ''))
  check('geometry：空范围不产刻度', rulerTicks({ finiteEnd: null, infinite: true, start: 0, end: 0 }, 80, 800).length === 0)
}
{
  const finite: DisplayRange = { finiteEnd: 12.5, infinite: false, start: 0, end: 35 }
  check('geometry：有限适配按显示末端', near(fitPxPerSecond(finite, 700), 20))
  const infinite: DisplayRange = { finiteEnd: 12.5, infinite: true, start: 0, end: 60 }
  check('geometry：无限适配按 60s', near(fitPxPerSecond(infinite, 600), 10))
  check('geometry：适配视口为 0 回下限', fitPxPerSecond(finite, 0) === MIN_PPS)
  check('geometry：适配结果夹在 5–500', fitPxPerSecond(finite, 100000) === MAX_PPS)
}

// ── geometry：命中 ─────────────────────────────────────────────────────────
{
  const clips = [{ clipKey: 'c1', trackId: 'CAMERA#0', start: 4, duration: 6 }]
  const base = {
    clips,
    time: 0,
    trackId: 'CAMERA#0',
    viewportWidth: 800,
    pxPerSecond: 80,
    scrollLeft: 0,
  }
  check('geometry：左边缘 6px 命中 clip-edge-left', hitTest({ ...base, xPx: 4 * 80 + 6 }).kind === 'clip-edge-left')
  check('geometry：主体命中 clip', hitTest({ ...base, xPx: 4 * 80 + 20 }).kind === 'clip')
  check('geometry：右边缘 6px 命中 clip-edge-right', hitTest({ ...base, xPx: 10 * 80 - 6 }).kind === 'clip-edge-right')
  const empty = hitTest({ ...base, xPx: 900 })
  check('geometry：轨道空白命中 track-empty', empty.kind === 'track-empty' && empty.trackId === 'CAMERA#0')
  check('geometry：标尺命中 ruler', hitTest({ ...base, xPx: 100, rulerHit: true }).kind === 'ruler')
  check('geometry：无 trackId 且空白命中 none', hitTest({ ...base, trackId: undefined, xPx: 900 }).kind === 'none')
  check('geometry：xPx 换算返回时间', near(hitTest({ ...base, xPx: 400 }).time, 5))
}
{
  const infinite = [{ clipKey: 'inf', trackId: 'CAMERA#0', start: 4, duration: -1, infinite: true }]
  const base = {
    clips: infinite,
    time: 0,
    trackId: 'CAMERA#0',
    viewportWidth: 800,
    pxPerSecond: 80,
    scrollLeft: 0,
  }
  check('geometry：无限片段主体命中 clip', hitTest({ ...base, xPx: 600 }).kind === 'clip')
  check('geometry：无限片段没有右裁切手柄', hitTest({ ...base, xPx: 799 }).kind === 'clip')
}
{
  const overlapping = [
    { clipKey: 'first', trackId: 'CAMERA#0', start: 0, duration: 10 },
    { clipKey: 'second', trackId: 'CAMERA#0', start: 5, duration: 3 },
  ]
  check('geometry：重叠取后开始者', hitTest({
    clips: overlapping,
    time: 0,
    trackId: 'CAMERA#0',
    viewportWidth: 800,
    pxPerSecond: 80,
    scrollLeft: 0,
    xPx: 5.5 * 80,
  }).clipKey === 'second')
}

// ── clipEdit：分割 ─────────────────────────────────────────────────────────
{
  const source: JsonObject = {
    id: 'cam_a',
    start_time: 10,
    duration: 8,
    loop: true,
    loop_count: 2,
    loop_mode: 'repeat',
    exit: { on_complete: 'goto', target: 'cam_b' },
    objects: {
      yaw: {
        keyframes: [
          { time: 0, value: 0 },
          { time: 3, value: 3 },
          { time: 4, value: 4 },
          { time: 7, value: 7 },
        ],
      },
      fov: { value: 70 },
    },
  }
  const { left, right } = splitClipObject(source, 14)
  check('clipEdit：左段时长', left.duration === 4 && left.start_time === 10)
  check('clipEdit：右段起点/时长', right.start_time === 14 && right.duration === 4)
  check('clipEdit：左段关键帧 t<split', JSON.stringify((left.objects as JsonObject).yaw) === JSON.stringify({
    keyframes: [{ time: 0, value: 0 }, { time: 3, value: 3 }],
  }))
  check('clipEdit：右段关键帧 t>=split 且时间平移', JSON.stringify((right.objects as JsonObject).yaw) === JSON.stringify({
    keyframes: [{ time: 0, value: 4 }, { time: 3, value: 7 }],
  }))
  check('clipEdit：非关键帧属性复制', JSON.stringify((left.objects as JsonObject).fov) === JSON.stringify({ value: 70 })
    && JSON.stringify((right.objects as JsonObject).fov) === JSON.stringify({ value: 70 }))
  check('clipEdit：loop/loop_count/loop_mode/exit 复制', left.loop === true && left.loop_count === 2
    && left.loop_mode === 'repeat' && JSON.stringify(left.exit) === JSON.stringify(right.exit))
  check('clipEdit：默认 id 后缀', left.id === 'cam_a_a' && right.id === 'cam_a_b')
  check('clipEdit：源对象不被修改', source.duration === 8
    && isJsonObject((source.objects as JsonObject).yaw)
    && ((source.objects as JsonObject).yaw as JsonObject).keyframes !== undefined
    && (((source.objects as JsonObject).yaw as JsonObject).keyframes as JsonValue[]).length === 4)

  const anonymous = splitClipObject({ start_time: 0, duration: 4, objects: {} }, 2)
  check('clipEdit：无 id 片段分割后不写 id', !('id' in anonymous.left) && !('id' in anonymous.right))
  const custom = splitClipObject({ id: 'x', start_time: 0, duration: 4, objects: {} }, 2, (suffix) => `n_${suffix}`)
  check('clipEdit：自定义 newId 生效', custom.left.id === 'n_a' && custom.right.id === 'n_b')
  let threw = false
  try {
    splitClipObject({ id: 'x', start_time: 0, duration: 4, objects: {} }, 4)
  } catch {
    threw = true
  }
  check('clipEdit：端点分割抛错', threw)
}

// ── clipEdit：顺排 / 波纹 ──────────────────────────────────────────────────
check('clipEdit：顺排保持首个最小起点', JSON.stringify(compactStarts([
  { start: 10, duration: 2 },
  { start: 3, duration: 1 },
  { start: 20, duration: 5 },
])) === JSON.stringify([4, 3, 6]))
check('clipEdit：空数组顺排', JSON.stringify(compactStarts([])) === JSON.stringify([]))
check('clipEdit：单条波纹删除左移', JSON.stringify(rippleShift(
  [{ start: 0, duration: 2 }, { start: 5, duration: 3 }, { start: 12, duration: 1 }],
  [{ start: 4, duration: 2 }],
)) === JSON.stringify([0, 3, 10]))
check('clipEdit：多条波纹删除从后往前累计', JSON.stringify(rippleShift(
  [{ start: 1, duration: 1 }, { start: 6, duration: 1 }, { start: 10, duration: 1 }, { start: 20, duration: 1 }],
  [{ start: 2, duration: 2 }, { start: 8, duration: 2 }],
)) === JSON.stringify([1, 4, 6, 16]))

// ── commands：移动 / 跨轨 / 裁切 ───────────────────────────────────────────
{
  const store = openStore()
  const a = handleById(store, 'cam_a')
  const framesBefore = JSON.stringify((a.clip.objects as JsonObject).yaw)
  commitOk(store, { kind: 'timeline.moveClips', clipKeys: [a.key], deltaSeconds: 2.5 }, '命令：移动单片段')
  check('命令：移动后 start+2.5', a.clip.start_time === 2.5)
  check('命令：移动不改关键帧相对位置', JSON.stringify((a.clip.objects as JsonObject).yaw) === framesBefore)
  commitFails(store, { kind: 'timeline.moveClips', clipKeys: [a.key], deltaSeconds: -100 }, '命令：移动后 start<0 拒绝')
  check('命令：拒绝后 start 未变', clipById(store, 'cam_a').start_time === 2.5)
  store.undo()
  check('命令：撤销一次回退移动', clipById(store, 'cam_a').start_time === 0)

  const b = handleById(store, 'cam_b')
  commitFails(store, {
    kind: 'timeline.moveClips',
    clipKeys: [b.key],
    deltaSeconds: 1,
    targetTrackId: 'AUDIO#2',
  }, '命令：CAMERA→AUDIO 跨轨拒绝')
  commitOk(store, {
    kind: 'timeline.moveClips',
    clipKeys: [b.key],
    deltaSeconds: 1,
    targetTrackId: 'CAMERA#1',
  }, '命令：同类型跨轨成功')
  const moved = store.registry.handle(b.key)
  check('命令：跨轨后片段在新轨', moved !== undefined && moved.trackIndex === 1
    && clipById(store, 'cam_b').start_time === 13)

  const aStart = clipById(store, 'cam_a').start_time
  const cStart = clipById(store, 'cam_c').start_time
  commitFails(store, {
    kind: 'timeline.moveClips',
    clipKeys: [handleById(store, 'cam_a').key, handleById(store, 'cam_c').key],
    deltaSeconds: -100,
  }, '命令：多选任一越界整组拒绝')
  check('命令：多选失败不部分移动', clipById(store, 'cam_a').start_time === aStart
    && clipById(store, 'cam_c').start_time === cStart)
}
{
  const store = openStore()
  const a = handleById(store, 'cam_a')
  const frames = JSON.stringify((a.clip.objects as JsonObject).yaw)
  commitOk(store, { kind: 'timeline.trimClip', clipKey: a.key, edge: 'left', newTime: 2 }, '命令：左裁切')
  check('命令：左裁切 start/duration', a.clip.start_time === 2 && a.clip.duration === 8)
  check('命令：裁切不碰关键帧数组', JSON.stringify((a.clip.objects as JsonObject).yaw) === frames)
  commitOk(store, { kind: 'timeline.trimClip', clipKey: a.key, edge: 'left', newTime: 100 }, '命令：左裁切夹到最小长度')
  check('命令：左裁切下限 0.05s', near(a.clip.duration as number, 0.05))
  commitOk(store, { kind: 'timeline.trimClip', clipKey: a.key, edge: 'right', newTime: -100 }, '命令：右裁切夹到 0.05s')
  check('命令：右裁切下限 0.05s', near(a.clip.duration as number, 0.05))

  commitOk(store, {
    kind: 'clip.add',
    trackIndex: 0,
    clip: { id: 'inf_a', start_time: 30, duration: -1, objects: {} },
  }, '命令：添加无限片段夹具')
  const infinite = handleById(store, 'inf_a')
  commitFails(store, { kind: 'timeline.trimClip', clipKey: infinite.key, edge: 'right', newTime: 31 }, '命令：无限片段右裁切拒绝')
  check('命令：无限片段拒绝后不变', clipById(store, 'inf_a').duration === -1
    && clipById(store, 'inf_a').start_time === 30)
  const infiniteKey = handleById(store, 'inf_a').key
  commitOk(store, { kind: 'timeline.trimClip', clipKey: infiniteKey, edge: 'left', newTime: 32 }, '命令：无限片段左裁切允许')
  check('命令：无限片段左裁切后仍无限', clipById(store, 'inf_a').start_time === 32
    && clipById(store, 'inf_a').duration === -1)
}

// ── commands：分割 ─────────────────────────────────────────────────────────
{
  const store = openStore()
  const a = handleById(store, 'cam_a')
  const oldKey = a.key
  commitOk(store, { kind: 'timeline.splitClip', clipKey: oldKey, splitTime: 4 }, '命令：分割 10s 片段于 4s')
  const left = clipById(store, 'cam_a_a')
  const right = clipById(store, 'cam_a_b')
  check('命令：分割左段 0/4', left.start_time === 0 && left.duration === 4)
  check('命令：分割右段 4/6', right.start_time === 4 && right.duration === 6)
  check('命令：分割关键帧 t=4 归右', JSON.stringify((left.objects as JsonObject).yaw) === JSON.stringify({
    keyframes: [{ time: 0, value: 0 }, { time: 2, value: 10 }],
  }) && JSON.stringify((right.objects as JsonObject).yaw) === JSON.stringify({
    keyframes: [{ time: 0, value: 20 }, { time: 2, value: 30 }, { time: 4, value: 40 }],
  }))
  check('命令：分割后原 clipKey 不在活片段集合', !liveKeys(store).has(oldKey))
  commitFails(store, {
    kind: 'timeline.splitClip',
    clipKey: handleById(store, 'cam_a_a').key,
    splitTime: 0.005,
  }, '命令：端点 0.01s 内分割拒绝')
  store.undo()
  check('命令：撤销分割恢复原片段', clipById(store, 'cam_a').duration === 10 && liveKeys(store).size === 4)
  const restored = handleById(store, 'cam_a')
  commitOk(store, { kind: 'timeline.splitClip', clipKey: restored.key, splitTime: 5 }, '命令：撤销后可再次分割')
  check('命令：再次分割产生左右两段', clipById(store, 'cam_a_a').duration === 5
    && clipById(store, 'cam_a_b').duration === 5)
}
{
  const store = openStore(fixtureWith((root) => {
    root.paths = [{ id: 'p1', clip: 'cam_c', axes: ['x'], geometry: 'line' }]
  }))
  const c = handleById(store, 'cam_c')
  commitFails(store, { kind: 'timeline.splitClip', clipKey: c.key, splitTime: 21 }, '命令：被 paths 引用的片段分割拒绝')
  check('命令：引用拒绝后文档不变', clipById(store, 'cam_c').duration === 5)
}
{
  const store = openStore()
  commitOk(store, {
    kind: 'clip.add',
    trackIndex: 3,
    clip: { id: 'adj_inf', start_time: 0, duration: -1, objects: {} },
  }, '命令：添加无限片段（ADJUST）')
  const infinite = handleById(store, 'adj_inf')
  commitFails(store, { kind: 'timeline.splitClip', clipKey: infinite.key, splitTime: 1 }, '命令：无限片段分割拒绝')
  check('命令：无限片段分割拒绝后文档不变', clipById(store, 'adj_inf').duration === -1)
}

// ── commands：删除 / 波纹删除 ──────────────────────────────────────────────
{
  const store = openStore(fixtureWith((root) => {
    root.paths = [{ id: 'p1', clip: 'cam_c', axes: ['x'], geometry: 'line' }]
  }))
  const c = handleById(store, 'cam_c')
  const b = handleById(store, 'cam_b')
  commitFails(store, { kind: 'timeline.deleteClips', clipKeys: [b.key, c.key] }, '命令：删除含被引用片段整组拒绝')
  check('命令：删除整组拒绝不部分删除', clipById(store, 'cam_b').id === 'cam_b'
    && clipById(store, 'cam_c').id === 'cam_c')
  commitOk(store, { kind: 'timeline.deleteClips', clipKeys: [b.key] }, '命令：删除未引用片段')
  const live = currentClipSet(store)
  check('命令：删除后 id 消失', ![...live].some((clip) => clip.id === 'cam_b'))
}
{
  const store = openStore(fixtureWith((root) => {
    root.timeline = {
      tracks: [
        {
          type: 'CAMERA',
          clips: [
            { id: 'r1', start_time: 0, duration: 2, objects: {} },
            { id: 'r2', start_time: 5, duration: 3, objects: {} },
            { id: 'r3', start_time: 12, duration: 1, objects: {} },
          ],
        },
        { type: 'AUDIO', clips: [{ id: 'a1', start_time: 12, duration: 1, objects: {} }] },
      ],
    }
  }))
  const r2 = handleById(store, 'r2')
  commitOk(store, { kind: 'timeline.rippleDelete', clipKeys: [r2.key] }, '命令：波纹删除')
  check('命令：同轨后续片段左移删除长度', clipById(store, 'r3').start_time === 9)
  check('命令：删除点之前的片段不动', clipById(store, 'r1').start_time === 0)
  check('命令：其他轨道不动', clipById(store, 'a1').start_time === 12)
  commitOk(store, {
    kind: 'clip.add',
    trackIndex: 0,
    clip: { id: 'r_inf', start_time: 30, duration: -1, objects: {} },
  }, '命令：添加无限片段用于波纹删除')
  const infinite = handleById(store, 'r_inf')
  commitFails(store, { kind: 'timeline.rippleDelete', clipKeys: [infinite.key] }, '命令：无限片段波纹删除拒绝')
  check('命令：无限片段波纹删除拒绝后仍存在', clipById(store, 'r_inf').start_time === 30)
}

// ── commands：循环 / 顺排 / 粘贴 ──────────────────────────────────────────
{
  const store = openStore()
  const a = handleById(store, 'cam_a')
  commitOk(store, { kind: 'timeline.toggleLoop', clipKeys: [a.key] }, '命令：开启循环')
  check('命令：false→true 设 loop_count=1 且时长不变', a.clip.loop === true && a.clip.loop_count === 1
    && a.clip.duration === 10)
  commitOk(store, { kind: 'timeline.toggleLoop', clipKeys: [a.key] }, '命令：关闭循环')
  check('命令：true→false 保留 loop_count 且时长不变', a.clip.loop === false && a.clip.loop_count === 1
    && a.clip.duration === 10)
  const b = handleById(store, 'cam_b')
  commitOk(store, { kind: 'timeline.toggleLoop', clipKeys: [b.key] }, '命令：多选前先让 cam_b 循环')
  commitOk(store, { kind: 'timeline.toggleLoop', clipKeys: [a.key, b.key] }, '命令：多选以第一个当前值取反')
  check('命令：多选统一为 true', a.clip.loop === true && b.clip.loop === true)
  commitOk(store, {
    kind: 'clip.add',
    trackIndex: 0,
    clip: { id: 'loop_inf', start_time: 40, duration: -1, objects: {} },
  }, '命令：添加无限片段用于循环')
  const infinite = handleById(store, 'loop_inf')
  commitFails(store, { kind: 'timeline.toggleLoop', clipKeys: [infinite.key] }, '命令：无限片段开启循环拒绝')
  check('命令：无限片段循环拒绝后未改', clipById(store, 'loop_inf').loop !== true)
}
{
  const store = openStore(fixtureWith((root) => {
    root.timeline = {
      tracks: [
        {
          type: 'CAMERA',
          clips: [
            { id: 's1', start_time: 0, duration: 2, objects: {} },
            { id: 's2', start_time: 5, duration: 2, objects: {} },
            { id: 's3', start_time: 12, duration: 1, objects: {} },
            { id: 'keep', start_time: 8, duration: 1, objects: {} },
          ],
        },
      ],
    }
  }))
  const s1 = handleById(store, 's1').key
  const s2 = handleById(store, 's2').key
  const s3 = handleById(store, 's3').key
  commitOk(store, { kind: 'timeline.compactSelection', clipKeys: [s1, s2, s3] }, '命令：顺排 3 片段')
  check('命令：顺排首片段保持最小 start', clipById(store, 's1').start_time === 0)
  check('命令：顺排后续紧贴', clipById(store, 's2').start_time === 2 && clipById(store, 's3').start_time === 4)
  check('命令：未选中片段不动', clipById(store, 'keep').start_time === 8)
  commitOk(store, {
    kind: 'clip.add',
    trackIndex: 0,
    clip: { id: 's_inf', start_time: 40, duration: -1, objects: {} },
  }, '命令：添加无限片段用于顺排')
  const infinite = handleById(store, 's_inf').key
  commitFails(store, { kind: 'timeline.compactSelection', clipKeys: [s1, infinite] }, '命令：含无限片段顺排拒绝')
  check('命令：顺排拒绝后未改变', clipById(store, 's1').start_time === 0)
}
{
  const store = openStore()
  commitOk(store, {
    kind: 'timeline.pasteClips',
    targetTrackId: 'CAMERA#1',
    atTime: 30,
    clips: [
      { start_time: 0, duration: 2, objects: {} },
      { start_time: 2, duration: 3, objects: {} },
    ],
  }, '命令：粘贴 2 片段')
  const clips = trackClips(store, 1)
  check('命令：粘贴保持相对偏移', clips.length === 2
    && (clips[0] as JsonObject).start_time === 30
    && (clips[1] as JsonObject).start_time === 32)
  check('命令：粘贴生成新 clipKey', clips.every((clip) => isJsonObject(clip)
    && store.registry.keyOf(clip) !== undefined))
  const depthBefore = store.undoDepth()
  store.undo()
  const clipsAfter = trackClips(store, 1)
  check('命令：粘贴一次撤销移除全部', clipsAfter.length === 0 && store.undoDepth() < depthBefore)
  commitFails(store, {
    kind: 'timeline.pasteClips',
    targetTrackId: 'AUDIO#2',
    atTime: 0,
    clips: [{ start_time: 0, duration: 1, objects: { yaw: { value: 0 } } }],
  }, '命令：粘贴到不同类型轨道拒绝')
  commitOk(store, {
    kind: 'timeline.pasteClips',
    targetTrackId: 'CAMERA#1',
    atTime: 0,
    clips: [{ start_time: -5, duration: 1, objects: {} }],
  }, '命令：粘贴负起点被夹到 0')
  const negativeClips = trackClips(store, 1)
  check('命令：粘贴保证 start>=0', negativeClips.length === 1
    && (negativeClips[0] as JsonObject).start_time === 0)
}

// ── commands：轨道增删改排序 ───────────────────────────────────────────────
{
  const store = openStore()
  commitOk(store, { kind: 'timeline.addTrack', type: 'OVERLAY' }, '命令：添加轨道')
  const tracks = store.doc?.timeline.tracks
  const last = Array.isArray(tracks) ? tracks[4] : undefined
  check('命令：新轨道追加在末尾且 clips 为空', Array.isArray(tracks) && tracks.length === 5
    && isJsonObject(last) && last.type === 'OVERLAY'
    && Array.isArray(last.clips) && last.clips.length === 0)
  commitOk(store, { kind: 'timeline.addTrack', type: 'LETTERBOX' }, '命令：添加 LETTERBOX')
  commitFails(store, { kind: 'timeline.addTrack', type: 'LETTERBOX' }, '命令：重复 LETTERBOX 拒绝')
  commitFails(store, { kind: 'timeline.addTrack', type: '   ' }, '命令：空轨道 type 拒绝')
  commitFails(store, { kind: 'timeline.removeTrack', trackId: 'CAMERA#0' }, '命令：非空轨道删除拒绝')
  commitOk(store, { kind: 'timeline.removeTrack', trackId: 'ADJUST#3' }, '命令：空轨道删除成功')
  check('命令：删除轨道后长度减少', Array.isArray(store.doc?.timeline.tracks)
    && (store.doc?.timeline.tracks as JsonValue[]).length === 5)
}
{
  const store = openStore()
  commitOk(store, { kind: 'timeline.reorderTracks', trackId: 'ADJUST#3', toIndex: 0 }, '命令：轨道移到开头')
  const tracks = store.doc?.timeline.tracks
  const first = Array.isArray(tracks) ? tracks[0] : undefined
  check('命令：排序后轨道顺序变化且片段时间不变', Array.isArray(tracks)
    && isJsonObject(first) && first.type === 'ADJUST'
    && clipById(store, 'cam_a').start_time === 0)
  commitOk(store, { kind: 'timeline.reorderTracks', trackId: 'CAMERA#1', toIndex: 99 }, '命令：排序 toIndex 夹到末尾')
  const reordered = store.doc?.timeline.tracks
  const last = Array.isArray(reordered) ? reordered[3] : undefined
  check('命令：排序夹取后位于末尾', Array.isArray(reordered) && reordered.length === 4
    && isJsonObject(last) && last.type === 'CAMERA')
  commitFails(store, { kind: 'timeline.reorderTracks', trackId: 'CAMERA#99', toIndex: 0 }, '命令：不存在的轨道 id 拒绝')
}
{
  const store = openStore()
  commitOk(store, { kind: 'timeline.renameTrack', trackId: 'CAMERA#0', name: '镜头 A' }, '命令：重命名轨道')
  const tracks = store.doc?.timeline.tracks
  const first = Array.isArray(tracks) ? tracks[0] : undefined
  check('命令：重命名写入 name 且不改 type', isJsonObject(first)
    && first.name === '镜头 A' && first.type === 'CAMERA')
  commitFails(store, { kind: 'timeline.renameTrack', trackId: 'CAMERA#0', name: '  ' }, '命令：空轨道名拒绝')
  commitFails(store, { kind: 'timeline.renameTrack', trackId: 'CAMERA#1', name: '镜头 A' }, '命令：重名轨道拒绝')
  const after = Array.isArray(store.doc?.timeline.tracks) ? (store.doc?.timeline.tracks as JsonValue[])[0] : undefined
  check('命令：重名拒绝后 name 未变', isJsonObject(after) && after.name === '镜头 A')
}

// ── commands：触发器前置 ───────────────────────────────────────────────────
{
  const store = openStore()
  commitOk(store, {
    kind: 'trigger.requires.add',
    triggerIdentity: 't_login',
    index: 1,
    requirementType: 'script_started',
    targetScriptId: 'third',
  }, '命令：requires.add')
  const triggers = store.doc?.meta.triggers
  const login = Array.isArray(triggers) ? triggers[0] as JsonObject : {}
  // 磁盘扁平形状：`script` 在条目顶层（ScriptValidator.java:2511-2526）。
  check('命令：requires.add 追加对象写法', JSON.stringify(login.requires) === JSON.stringify([
    'other',
    { type: 'script_started', script: 'third' },
  ]))
  commitOk(store, {
    kind: 'trigger.requires.update',
    triggerIdentity: 't_login',
    index: 0,
    requirementType: 'script_played',
    targetScriptId: 'other2',
  }, '命令：requires.update 字符串保持字符串')
  check('命令：script_played 字符串简写不转对象', login.requires !== undefined
    && (login.requires as JsonValue[])[0] === 'other2')
  commitOk(store, {
    kind: 'trigger.requires.update',
    triggerIdentity: 't_login',
    index: 1,
    requirementType: 'script_completed',
    targetScriptId: 'third2',
  }, '命令：requires.update 内置类型改类型')
  // 磁盘扁平形状：`script` 在条目顶层（ScriptValidator.java:2511-2526）。
  check('命令：update 写回对象形状', JSON.stringify((login.requires as JsonValue[])[1]) === JSON.stringify({
    type: 'script_completed',
    script: 'third2',
  }))
  commitOk(store, { kind: 'trigger.requires.remove', triggerIdentity: 't_login', index: 1 }, '命令：requires.remove')
  commitOk(store, { kind: 'trigger.requires.remove', triggerIdentity: 't_login', index: 0 }, '命令：requires.remove 最后一个')
  check('命令：数组为空删除 requires 键', !('requires' in login))
  commitFails(store, {
    kind: 'trigger.requires.remove',
    triggerIdentity: 't_login',
    index: 0,
  }, '命令：requires.remove 越界拒绝')
  commitFails(store, {
    kind: 'trigger.requires.add',
    triggerIdentity: 't_login',
    index: 99,
    requirementType: 'script_played',
    targetScriptId: 'x',
  }, '命令：requires.add 越界拒绝')
}
{
  const store = openStore()
  const loc = (store.doc?.meta.triggers as JsonValue[])[1] as JsonObject
  const before = JSON.stringify(loc.requires)
  commitFails(store, {
    kind: 'trigger.requires.update',
    triggerIdentity: 't_loc',
    index: 1,
    requirementType: 'script_played',
    targetScriptId: 'x',
  }, '命令：自定义前置 update 拒绝')
  commitFails(store, {
    kind: 'trigger.requires.remove',
    triggerIdentity: 't_loc',
    index: 1,
  }, '命令：自定义前置 remove 拒绝')
  const current = (store.doc?.meta.triggers as JsonValue[])[1] as JsonObject
  check('命令：自定义前置拒绝后数组不变', JSON.stringify(current.requires) === before)
}
{
  const store = openStore()
  commitOk(store, {
    kind: 'trigger.requires.add',
    triggerIdentity: 'death#2',
    index: 0,
    requirementType: 'script_played',
    targetScriptId: 'ghost',
  }, '命令：type#index 身份定位触发器')
  const death = (store.doc?.meta.triggers as JsonValue[])[2] as JsonObject
  // 磁盘扁平形状：`script` 在条目顶层（ScriptValidator.java:2511-2526）。
  check('命令：type#index 写入成功', JSON.stringify(death.requires) === JSON.stringify([
    { type: 'script_played', script: 'ghost' },
  ]))
}

// ── commands：setConditions / setFields ────────────────────────────────────
{
  const store = openStore()
  const triggersBefore = store.doc?.meta.triggers
  const loginBefore = JSON.stringify((triggersBefore as JsonValue[])[0])
  commitOk(store, {
    kind: 'trigger.setConditions',
    triggerIdentity: 't_loc',
    patch: { radius: 12 },
    remove: ['dimension'],
  }, '命令：trigger.setConditions patch + remove')
  const loc = (store.doc?.meta.triggers as JsonValue[])[1] as JsonObject
  const conditions = loc.conditions as JsonObject
  check('命令：conditions patch 生效', conditions.radius === 12)
  check('命令：conditions remove 生效', !('dimension' in conditions))
  check('命令：setConditions 不动其他触发器', JSON.stringify((store.doc?.meta.triggers as JsonValue[])[0]) === loginBefore)
  check('命令：setConditions 不改触发器数组顺序', Array.isArray(store.doc?.meta.triggers)
    && (store.doc?.meta.triggers as JsonValue[]).length === 3)
}
{
  const store = openStore()
  const login = (store.doc?.meta.triggers as JsonValue[])[0] as JsonObject
  commitOk(store, {
    kind: 'trigger.setFields',
    triggerIdentity: 't_login',
    patch: { repeatable: true, delay: 3, poll_interval: 60 },
  }, '命令：trigger.setFields 允许键')
  check('命令：setFields 写入值', login.repeatable === true && login.delay === 3 && login.poll_interval === 60)
  commitOk(store, {
    kind: 'trigger.setFields',
    triggerIdentity: 't_login',
    patch: { continuity: { sweep: true, dwell: 5 } },
  }, '命令：setFields continuity 对象')
  check('命令：continuity 写入', JSON.stringify(login.continuity) === JSON.stringify({ sweep: true, dwell: 5 }))
  commitOk(store, {
    kind: 'trigger.setFields',
    triggerIdentity: 't_login',
    patch: { delay: null },
  }, '命令：setFields null 删除可选字段')
  check('命令：null 删除 delay', !('delay' in login))
  commitFails(store, { kind: 'trigger.setFields', triggerIdentity: 't_login', patch: { type: 'death' } }, '命令：setFields 拒绝 type')
  commitFails(store, { kind: 'trigger.setFields', triggerIdentity: 't_login', patch: { id: 'x' } }, '命令：setFields 拒绝 id')
  commitFails(store, {
    kind: 'trigger.setFields',
    triggerIdentity: 't_login',
    patch: { conditions: { a: 1 } },
  }, '命令：setFields 拒绝其他键')
  commitFails(store, {
    kind: 'trigger.setFields',
    triggerIdentity: 't_login',
    patch: { poll_interval: 0 },
  }, '命令：setFields 拒绝非法 poll_interval')
  commitFails(store, {
    kind: 'trigger.setFields',
    triggerIdentity: 't_login',
    patch: { continuity: { sweep: 'yes' } },
  }, '命令：setFields 拒绝非法 continuity')
  const after = (store.doc?.meta.triggers as JsonValue[])[0] as JsonObject
  check('命令：setFields 拒绝后 type 未变', after.type === 'login'
    && after.repeatable === true && after.poll_interval === 60)
}

// ── 汇总 ───────────────────────────────────────────────────────────────────
console.log(`summary ok=${ok} fail=${fail}`)
if (fail > 0) {
  process.exitCode = 1
}
