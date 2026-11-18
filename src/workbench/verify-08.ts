/**
 * 08 轮自检（真实入口）：`node --experimental-strip-types src/workbench/verify-08.ts`
 *
 * 覆盖：叠化与参数过渡模型、lane 视图模型、连续性诊断、玩家移动预演、回放状态机，
 * 以及叠化命令在真实 `DocStore` 上的提交结果。
 */
import type { CatalogIndex } from '../core/schema/index.ts'
import { buildCatalog, indexCatalog } from '../core/schema/index.ts'
import { metaKeys } from '../core/doc/keys.ts'
import { parseDoc } from '../core/doc/parse.ts'
import { DocStore } from '../core/doc/store.ts'
import { isJsonObject } from '../core/doc/json.ts'
import type { JsonObject, JsonValue } from '../core/doc/types.ts'
import type { ClipViewEntry, ScriptView, TrackViewEntry } from '../workbench/api/documents.ts'

import {
  CAMERA_TRACK_TYPE,
  COMPOSITE_PATHS,
  buildCrossfadeCommands,
  buildCrossfadeView,
  buildParamView,
  buildTransitionView,
  makeTransitionClip,
  mergeCrossfadeFrames,
  buildWindow,
} from '../features/camera/transition/model.ts'
import { buildLaneView, collectLaneClips } from '../features/camera/lanes/model.ts'
import { buildContinuityView, readContinuityMeta } from '../features/camera/continuity/model.ts'
import { buildPlayerRoute, projectPoint } from '../features/camera/player/model.ts'
import {
  actionsFor,
  applyConnection,
  applyReport,
  applyRevisionChange,
  initialPlaybackState,
  playbackSummary,
  type PlaybackState,
  receiptTimeout,
  startSeek,
  startValidation,
} from '../features/camera/playback/model.ts'

let ok = 0
let fail = 0

function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  console.log(`FAIL ${label}: ${format(actual)}`)
}

function format(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 280 ? `${text.slice(0, 280)}...` : text
  } catch {
    return String(value)
  }
}

function near(actual: number, expected: number, epsilon = 1e-9): boolean {
  return Math.abs(actual - expected) <= epsilon
}

/** 全屏合成默认值（`dest` / `source` 都是 0,0,1,1）。 */
function fullScreen(): JsonObject {
  return {
    'dest.x': { value: 0 },
    'dest.y': { value: 0 },
    'dest.w': { value: 1 },
    'dest.h': { value: 1 },
    'source.x': { value: 0 },
    'source.y': { value: 0 },
    'source.w': { value: 1 },
    'source.h': { value: 1 },
  }
}

/** 08 夹具：A 0→2、B 1.5→3.5（重叠 0.5，B 两端帧 0→1）、C 3.5→4.5（morph）。 */
function fixture(): JsonObject {
  return {
    meta: {
      id: 'verify08',
      name: 'Verify 08',
      author: '',
      play_mode: 'exclusive',
      interruptible: false,
      skippable: false,
      hold_at_end: true,
      priority: 3,
      macro_loop: true,
      macro_loop_count: -1,
      macro_loop_mode: 'pingpong',
    },
    timeline: {
      tracks: [
        {
          type: 'CAMERA',
          name: '主镜头',
          clips: [
            { id: 'cA', start_time: 0, duration: 2, objects: fullScreen() },
            {
              id: 'cB',
              start_time: 1.5,
              duration: 2,
              objects: {
                ...fullScreen(),
                opacity: { keyframes: [{ time: 0, value: 0 }, { time: 0.5, value: 1 }, { time: 2, value: 1 }] },
                transition: { value: 'morph' },
                transition_params: { value: { fov: { mode: 'blend', duration: 0.4 } } },
              },
            },
            {
              id: 'cC',
              start_time: 3.5,
              duration: 1,
              objects: fullScreen(),
            },
          ],
        },
        {
          type: 'EVENT',
          name: '事件',
          clips: [
            {
              id: 'e1',
              start_time: 0,
              duration: 5,
              objects: {
                event: {
                  keyframes: [
                    { time: 0.5, value: { position: { x: 1, z: 2 }, command: 'move' } },
                    { time: 1, value: { position: { x: 3, z: 4 }, command: 'move' } },
                    { time: 9, value: { position: { x: 9, z: 9 }, command: 'move' } },
                  ],
                },
              },
            },
          ],
        },
        {
          type: 'MOD_EVENT',
          name: '模组事件',
          clips: [
            {
              id: 'm1',
              start_time: 0,
              duration: 3,
              objects: {
                mod_event: { keyframes: [{ time: 0.5, value: { event_type: 'flash', position: { x: 5, z: 5 } } }] },
              },
            },
          ],
        },
      ],
    },
  }
}

interface Opened {
  store: DocStore
  view: ScriptView
}

/** 打开夹具并把解析结果折成只读视图（与 `DocumentServiceImpl.view` 同口径）。 */
function openFixture(catalog: CatalogIndex, raw: JsonObject): Opened {
  const keys = metaKeys(catalog)
  const parsed = parseDoc(raw, { metaKeys: keys })
  if (!parsed.ok) {
    throw new Error(`fixture parse failed: ${format(parsed.issues)}`)
  }
  const store = new DocStore({ catalog, metaKeys: keys })
  store.open(parsed.doc, 'verify08.json')
  const doc = parsed.doc
  const meta = doc.meta as JsonObject

  const tracks: TrackViewEntry[] = []
  const rawTracks = (doc.timeline.tracks ?? []) as unknown as JsonObject[]
  for (let index = 0; index < rawTracks.length; index += 1) {
    const track = rawTracks[index]
    const type = typeof track.type === 'string' ? track.type : ''
    const name = typeof track.name === 'string' ? track.name : ''
    const clips: ClipViewEntry[] = []
    const rawClips = Array.isArray(track.clips) ? track.clips : []
    for (const rawClipValue of rawClips) {
      const rawClip = rawClipValue as JsonObject
      const clipKey = store.registry.keyOf(rawClip)
      if (clipKey === undefined) {
        continue
      }
      const start = typeof rawClip.start_time === 'number' ? rawClip.start_time : 0
      const duration = typeof rawClip.duration === 'number' ? rawClip.duration : 0
      const loop = rawClip.loop === true
      const loopCount = typeof rawClip.loop_count === 'number' ? rawClip.loop_count : undefined
      const infinite = duration < 0 || (loop && (loopCount ?? -1) < 0)
      const id = typeof rawClip.id === 'string' ? rawClip.id : undefined
      clips.push({
        clipKey,
        ...(id === undefined ? {} : { clipId: id }),
        start,
        duration,
        loop,
        ...(loopCount === undefined ? {} : { loopCount }),
        infinite,
        label: id ?? '未命名片段',
        references: 0,
        warn: false,
      })
    }
    tracks.push({ trackId: `${type}#${index}`, type, index, name, clips })
  }

  return {
    store,
    view: {
      docId: 'verify08',
      path: 'verify08.json',
      revision: 0,
      meta: {
        id: 'verify08',
        name: 'Verify 08',
        author: '',
        description: '',
        dimension: '',
        priority: typeof meta.priority === 'number' ? meta.priority : 0,
      },
      triggers: [],
      tracks,
      loopStart: null,
      loopEnd: null,
      contentEnd: 4.5,
      infinite: false,
    },
  }
}

/** 片段 `objects` 读取。 */
function objectsOf(store: DocStore): (clipKey: string) => JsonObject | null {
  return (clipKey) => {
    const handle = store.registry.handle(clipKey)
    if (handle === undefined) {
      return null
    }
    const objects = handle.clip.objects
    return isJsonObject(objects) ? objects : {}
  }
}

function cameraTrack(view: ScriptView): TrackViewEntry {
  const found = view.tracks.find((track) => track.type === CAMERA_TRACK_TYPE)
  if (found === undefined) {
    throw new Error('fixture 缺少 CAMERA 轨道')
  }
  return found
}

function main(): void {
  const catalog = indexCatalog(buildCatalog('verify-08'))
  const opened = openFixture(catalog, fixture())
  const { store, view } = opened
  const readObjects = objectsOf(store)
  const track = cameraTrack(view)

  // ── 08-02 叠化与参数过渡 ───────────────────────────────────────────────
  {
    const docView = buildTransitionView(view, readObjects)
    check('08-02 CAMERA 轨道数 1', docView.cameraTrackCount === 1, docView.cameraTrackCount)
    check('08-02 相邻交界 2 条（A→B、B→C）', docView.boundaries.length === 2, docView.boundaries.length)
    const boundary = docView.boundaries[0]
    check('08-02 A→B 有重叠', boundary.crossfade.overlap === true)
    check('08-02 A→B 识别为叠化', boundary.crossfade.identified === true, boundary.crossfade.structural)
    check('08-02 重叠时长 0.5s', near(boundary.crossfade.duration, 0.5), boundary.crossfade.duration)
    check('08-02 交界时刻 2s', near(boundary.boundaryTime, 2), boundary.boundaryTime)
    check('08-02 状态 = crossfade', boundary.state === 'crossfade', boundary.state)

    const second = docView.boundaries[1]
    check('08-02 B→C 参数过渡类型 morph', second.param.type === 'morph', second.param.type)
    check('08-02 B→C 有窗口', second.param.window !== null, second.param.window)
    check(
      '08-02 窗口总宽 0.5s（片段级缺省 0.5 决定，通道 0.4 不放大）',
      second.param.window !== null && near(second.param.window.width, 0.5),
      second.param.window,
    )
    check('08-02 状态 = morph', second.state === 'morph', second.state)

    // 未识别：B 的末端帧不是 1
    const clipA = makeTransitionClip(track, track.clips[0], 0, track.clips[0].clipKey, readObjects(track.clips[0].clipKey) ?? {})
    const wrongB = makeTransitionClip(track, { ...track.clips[1] }, 1, track.clips[1].clipKey, {
      ...fullScreen(),
      opacity: { keyframes: [{ time: 0, value: 0 }, { time: 2, value: 0.5 }] },
    })
    const wrongView = buildCrossfadeView(clipA, wrongB, 2)
    check('08-02 末端帧非 1 → 不识别', wrongView.identified === false, wrongView.identified)
    check('08-02 末端帧标记 bEndFrameOne = false', wrongView.bEndFrameOne === false, wrongView.bEndFrameOne)

    // 参数过渡：cut 无窗口
    const cutParam = buildParamView(
      makeTransitionClip(track, track.clips[0], 0, track.clips[0].clipKey, { ...fullScreen(), transition: { value: 'cut' } }),
      2,
    )
    check('08-02 transition=cut → 无窗口', cutParam.window === null, cutParam.window)
    check('08-02 cut 依然给出六通道', cutParam.channels.length === 6, cutParam.channels.length)

    // 显式时长 0 → 无窗口（运行时按硬切）
    const zeroParam = buildParamView(
      makeTransitionClip(track, track.clips[0], 0, track.clips[0].clipKey, {
        ...fullScreen(),
        transition: { value: 'morph' },
        transition_duration: { value: 0 },
      }),
      2,
    )
    check('08-02 时长 0 → 无窗口', zeroParam.window === null, zeroParam.window)

    const window = buildWindow(
      makeTransitionClip(track, track.clips[1], 1, track.clips[1].clipKey, readObjects(track.clips[1].clipKey) ?? {}),
      'morph',
      3.5,
      second.param.channels,
    )
    check('08-02 窗口以交界为中心', window !== null && near(window.start, 3.25) && near(window.end, 3.75), window)
  }

  // ── 08-02 命令在真实 store 上落地 ─────────────────────────────────────
  {
    const docView = buildTransitionView(view, readObjects)
    const boundary = docView.boundaries[0]
    const commands = buildCrossfadeCommands(boundary, 0.5)
    let allOk = true
    for (const command of commands) {
      const result = store.commit(command)
      allOk = allOk && result.ok
    }
    check('08-02 叠化命令全部提交成功', allOk)
    const after = buildTransitionView({ ...view, revision: store.revision }, objectsOf(store))
    check('08-02 提交后 B 的落点 = A 结束 - D', Object.values(after.boundaries)[0].b.start === 1.5, after.boundaries[0]?.b.start)
    const bObjects = objectsOf(store)(track.clips[1].clipKey) ?? {}
    const opacity = bObjects[COMPOSITE_PATHS.opacity]
    check(
      '08-02 提交后 opacity 两端帧 0 → 1（区间外帧保留）',
      isJsonObject(opacity)
        && Array.isArray(opacity.keyframes)
        && (opacity.keyframes as JsonValue[]).length === 3,
      opacity,
    )
    check('08-02 合并替换区间内帧、保留区间外帧', mergeCrossfadeFrames([{ time: 1, value: 0.3 }, { time: 0, value: 0 }, { time: 0.5, value: 1 }], 0.5).length === 3)
  }

  // ── 08-04 lane 视图 ───────────────────────────────────────────────────
  {
    const clips = collectLaneClips(track, readObjects)
    const laneView = buildLaneView(track, clips, 1.8)
    check('08-04 播放头 1.8s 有 2 条 lane', laneView.lanes.length === 2, laneView.lanes.length)
    check('08-04 下层是 A（index 0）', laneView.lanes[0]?.label === 'cA', laneView.lanes[0]?.label)
    check('08-04 上层是 B 且角色 = 叠化', laneView.lanes[1]?.role === 'crossfade', laneView.lanes[1]?.role)
    check('08-04 最上层徽标只在 B', laneView.lanes[1]?.top === true && laneView.lanes[0]?.top === false)
    check(
      '08-04 叠化行重叠区 = B 起点 → A 结束',
      laneView.lanes[1]?.overlapStart === 1.5 && laneView.lanes[1]?.overlapEnd === 2,
      [laneView.lanes[1]?.overlapStart, laneView.lanes[1]?.overlapEnd],
    )
    check(
      '08-04 叠化行不透明度摘要写成 0 → 1',
      laneView.lanes[1]?.summary.opacity.text.startsWith('0 → 1'),
      laneView.lanes[1]?.summary.opacity.text,
    )

    const gap = buildLaneView(track, clips, 2.6)
    check('08-04 播放头 2.6s 只剩 B 一条 lane', gap.lanes.length === 1 && gap.lanes[0]?.label === 'cB', gap.lanes.length)

    const morph = buildLaneView(track, clips, 3.4)
    check('08-04 morph 窗口内只出单条 lane', morph.lanes.length === 1 && morph.lanes[0]?.role === 'morph', morph.lanes)
    check('08-04 morph 行给出出场片段', morph.lanes[0]?.fromLabel === 'cB', morph.lanes[0]?.fromLabel)

    const tail = buildLaneView(track, clips, 3.8)
    check('08-04 窗口外回到普通 lane', tail.lanes.length === 1 && tail.lanes[0]?.role === 'single', tail.lanes)

    const empty = buildLaneView(track, clips, 10)
    check('08-04 播放头在末尾外 → 空态 gap', empty.lanes.length === 0 && empty.emptyKind === 'gap', empty.emptyKind)
  }

  // ── 08-06 连续性诊断 ─────────────────────────────────────────────────
  {
    const meta = store.doc === null ? null : (store.doc.meta as JsonObject)
    const fields = readContinuityMeta(meta)
    check('08-06 play_mode = exclusive', fields.playMode === 'exclusive', fields.playMode)
    check('08-06 interruptible = false', fields.interruptible === false)
    check('08-06 hold_at_end = true', fields.holdAtEnd === true)
    check('08-06 macro_loop_count = -1（无限）', fields.macroLoopCount === -1, fields.macroLoopCount)

    const continuity = buildContinuityView({
      meta,
      tracks: view.tracks,
      transitions: buildTransitionView(view, readObjects),
    })
    check(
      '08-06 末尾保持 + 不可跳过 → 死锁警告',
      continuity.issues.some((issue) => issue.code === 'continuity.deadlock'),
      continuity.issues.map((issue) => issue.code),
    )
    check(
      '08-06 同脚本再触发 = 排队（不可打断）',
      continuity.sameScript.code === 'same.queued',
      continuity.sameScript.code,
    )
    check('08-06 跨脚本规则三条', continuity.crossScript.length === 3, continuity.crossScript.length)
    check(
      '08-06 退场门禁里「被顶掉」被拒绝',
      continuity.gates.find((gate) => gate.code === 'exit.replaced')?.status === 'blocked',
      continuity.gates,
    )
    check(
      '08-06 自然结束被 hold_at_end 拒绝',
      continuity.gates.find((gate) => gate.code === 'exit.natural')?.status === 'blocked',
      continuity.gates,
    )
    check('08-06 系统停止不受限', continuity.gates.find((gate) => gate.code === 'exit.system-stop')?.status === 'allowed')
    check('08-06 片段循环条目覆盖 CAMERA 三段', continuity.clipLoops.length === 3, continuity.clipLoops.length)
    check('08-06 交界摘要两条', continuity.boundaries.length === 2, continuity.boundaries.length)
    check(
      '08-06 叠化摘要给出 B 两端不透明度',
      continuity.boundaries[0]?.crossfadeEndpoints?.from === 0 && continuity.boundaries[0]?.crossfadeEndpoints?.to === 1,
      continuity.boundaries[0]?.crossfadeEndpoints,
    )
    check(
      '08-06 提示按错误→警告→信息排序',
      continuity.issues.every((issue, index) => {
        if (index === 0) {
          return true
        }
        const rank: Record<string, number> = { error: 0, warning: 1, info: 2 }
        return rank[continuity.issues[index - 1].severity] <= rank[issue.severity]
      }),
      continuity.issues.map((issue) => issue.severity),
    )
  }

  // ── 08-07 玩家移动预演 ───────────────────────────────────────────────
  {
    const route = buildPlayerRoute({
      view,
      objectsOf: (clipKey) => readObjects(clipKey),
      origin: { x: 0, z: 0 },
      meta: store.doc === null ? null : (store.doc.meta as JsonObject),
    })
    check('08-07 找到 EVENT 轨', route.hasEventTrack === true)
    check('08-07 超界记录被丢弃 1 条', route.dropped === 1, route.dropped)
    check('08-07 目标 2 个', route.targets.length === 2, route.targets.length)
    check('08-07 第一个目标是起点', route.targets[0]?.role === 'anchor', route.targets[0]?.role)
    check('08-07 全局时间 = 片段起点 + 局部时间', near(route.targets[1]?.globalTime ?? -1, 1), route.targets[1]?.globalTime)
    check('08-07 绝对坐标原样', route.targets[0]?.world.x === 1 && route.targets[0]?.world.z === 2, route.targets[0]?.world)
    check(
      '08-07 相对坐标叠加预览原点',
      near(route.targets[1]?.world.x ?? -1, 3 + 0) && near(route.targets[1]?.world.z ?? -1, 4),
      route.targets[1]?.world,
    )
    check('08-07 产生移动（≥2 目标）', route.producesMovement === true)
    check('08-07 段数 = 目标数 - 1', route.segments.length === 1, route.segments.length)
    check(
      '08-07 MOD_EVENT 的 position 只提示不解析',
      route.modEventHasPosition === true && route.issues.some((issue) => issue.code === 'player.mod-event-position'),
      route.issues.map((issue) => issue.code),
    )
    check(
      '08-07 宏循环说明',
      route.issues.some((issue) => issue.code === 'player.macro-loop'),
      route.issues.map((issue) => issue.code),
    )

    const single = buildPlayerRoute({
      view,
      objectsOf: (clipKey) => readObjects(clipKey),
      origin: null,
      meta: null,
    })
    check('08-07 未设原点时用 (0,0)', single.originStored === false && single.origin.x === 0 && single.origin.z === 0)
    check(
      '08-07 未设原点给提示',
      single.issues.some((issue) => issue.code === 'player.origin-default'),
      single.issues.map((issue) => issue.code),
    )

    const projected = projectPoint({ minX: 0, maxX: 2, minZ: 0, maxZ: 4 }, { x: 1, z: 2 })
    check('08-07 画布投影归一到 0..1', near(projected.u, 0.5) && near(projected.v, 0.5), projected)

    const noEvent = buildPlayerRoute({
      view: { ...view, tracks: view.tracks.filter((candidate) => candidate.type !== 'EVENT') },
      objectsOf: (clipKey) => readObjects(clipKey),
      origin: null,
      meta: null,
    })
    check('08-07 无 EVENT 轨 → 空态 no-event-track', noEvent.emptyKind === 'no-event-track', noEvent.emptyKind)
  }

  // ── 08-08 回放状态机 ─────────────────────────────────────────────────
  {
    const initial = initialPlaybackState(true)
    check('08-08 初始 = 就绪', initial.phase === 'ready', initial.phase)
    check('08-08 未连接初始 = 未连接', initialPlaybackState(false).phase === 'disconnected')
    check('08-08 就绪：可校验、不可推送', actionsFor('ready').validate && !actionsFor('ready').push)
    check('08-08 校验中全禁用', !actionsFor('validating').validate && !actionsFor('validating').push)
    check('08-08 无效：可重试、推送禁用', actionsFor('invalid').retry && !actionsFor('invalid').push)
    check('08-08 有效：全部可用', actionsFor('valid').push && actionsFor('valid').seek)
    check('08-08 推送中 / 跳转中禁用重复推送', !actionsFor('pushing').push && !actionsFor('seeking').push)
    check('08-08 播放中：可暂停、停止、重新推送', actionsFor('playing').pause && actionsFor('playing').stop && actionsFor('playing').push)
    check('08-08 已暂停：可播放', actionsFor('paused').play)
    check('08-08 已停止：可推送跳转与播放', actionsFor('stopped').push && actionsFor('stopped').play)
    check('08-08 未连接全禁用', Object.values(actionsFor('disconnected')).every((value) => value === false))

    let state = startValidation(initial)
    check('08-08 校验开始进入校验中', state.phase === 'validating')
    state = { ...state, phase: 'valid', validatedRevision: 3 }
    state = applyRevisionChange(state, 4)
    check('08-08 修订号变化：有效 → 就绪', state.phase === 'ready', state.phase)

    let playing: PlaybackState = { ...initial, phase: 'playing', validatedRevision: 3, pushedAt: 100 }
    playing = applyRevisionChange(playing, 4)
    check('08-08 播放中改文档：保持播放', playing.phase === 'playing', playing.phase)
    check('08-08 播放中改文档：标为需重推', playing.stalePush === true)

    const report = applyReport(startSeek(initial), { playing: true, time: 2.5 })
    check('08-08 收到回执进入播放中', report.phase === 'playing', report.phase)
    check('08-08 回执清掉缺回执标记', report.missingReceipt === false)

    const seeking = startSeek(initial)
    check('08-08 跳转中 2 秒无回执标缺回执', receiptTimeout(seeking).missingReceipt === true)
    check('08-08 非跳转态不标缺回执', receiptTimeout({ ...initial, phase: 'playing' }).missingReceipt === false)

    const disconnected = applyConnection({ ...initial, phase: 'playing' }, false)
    check('08-08 断线回到未连接', disconnected.phase === 'disconnected', disconnected.phase)
    check('08-08 重连回到就绪', applyConnection(disconnected, true).phase === 'ready')

    const summary = playbackSummary({
      clipCount: 4,
      cameraClipCount: 3,
      transitions: buildTransitionView(view, readObjects),
    })
    check('08-08 摘要：叠化 1', summary.crossfadeCount === 1, summary.crossfadeCount)
    check('08-08 摘要：参数过渡 1', summary.morphCount === 1, summary.morphCount)
    check('08-08 摘要：共存 0（本夹具不共存）', summary.coexistCount === 0, summary.coexistCount)
  }

  console.log(`\n08 自检：ok ${ok} / fail ${fail}`)
  if (fail > 0) {
    process.exitCode = 1
  }
}

main()
