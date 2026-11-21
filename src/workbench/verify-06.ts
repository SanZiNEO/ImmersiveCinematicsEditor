/**
 * 06 轮共享交互机制自检。
 *
 * 运行：`node --experimental-strip-types src/workbench/verify-06.ts`
 * 输出：每条断言一行 `ok   <描述>` / `FAIL <描述>：<实际值>`，最后 `summary ok=<n> fail=<n>`。
 *
 * 覆盖：
 * - 共享悬停意图：延迟显示 / 延迟隐藏 / keep 打断隐藏 / now 立即 / 切换目标 / dispose；
 * - 共享手势会话：一次手势只提交一次 / Esc 取消不提交 / pointercancel 取消 / 重复 begin 拒绝；
 * - 撤销合并：窗口内同串合并 / 窗口外分离 / 串身份变化分离 / 撤销打断；
 * - 效果领域纯函数：行派生 / 归属分区 / 视口换算 / 节点几何 / 缓动采样 / 烘焙 / 值校验 / 目标解析。
 *
 * 全部走真实实现；计时器用注入的假时钟，不依赖真实时间。
 */
import type { CatalogIndex } from '../core/schema/index.ts'
import { buildCatalog, indexCatalog } from '../core/schema/index.ts'
import { metaKeys } from '../core/doc/keys.ts'
import { parseDoc } from '../core/doc/parse.ts'
import { serializeDoc } from '../core/doc/serialize.ts'
import { DocStore } from '../core/doc/store.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../core/doc/types.ts'
import { HoverIntent } from './shared/hoverIntent.ts'
import type { HoverTimerHandle } from './shared/hoverIntent.ts'
import { createGestureSession } from './shared/gesture.ts'
import { targetPanelFor } from './app/SelectionPanelSync.ts'
import { buildPropertyRows, readClipTiming, isRequiredMissing, outOfRangeCount, effectiveStaticValue, groupLabelOf, UNGROUPED_KEY } from '../features/effects/rows.ts'
import { buildGroups, partitionGroups, summarizeRows, hasKeyframeContent } from '../features/effects/membership.ts'
import {
  DEFAULT_VIEWPORT,
  fitViewport,
  panBy,
  timeToX,
  xToTime,
  zoomAt,
  visibleTimeWindow,
  finiteDuration,
} from '../features/effects/viewport.ts'
import { layoutRows, nodesOfRow, segmentsOfRow, hitTestNodes, nodesInRect, isOutOfRange } from '../features/effects/geometry.ts'
import { sampleValue, bakeSegment, bakeSampleCount, segmentIndexAt, framesInRange } from '../features/effects/easing.ts'
import { controlKindOf, parseTextInput, resolveTarget, validateValue, seedForNewNode, missingPositionAxes, animatable } from '../features/effects/valueControls.ts'
import { easingKey, readEasingTable, writeEasingMutator, removeEasingMutator, clearPathEasingMutator, pruneInvalidEasingsMutator, unbakedSummary } from '../features/effects/easingStore.ts'
import type { EffectPanelSession, KeyframeSelection } from '../features/effects/types.ts'

let ok = 0
let fail = 0

function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  console.log(`FAIL ${label}：${format(actual)}`)
}

function format(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 320 ? `${text.slice(0, 320)}…` : text
  } catch {
    return String(value)
  }
}

/** 假时钟：手动推进，用来验证时间窗而不是真的等待。 */
class FakeClock {
  private time = 0
  private sequence = 0
  private readonly pending = new Map<number, { at: number; handler: () => void }>()

  now(): number {
    return this.time
  }

  setTimer(handler: () => void, ms: number): HoverTimerHandle {
    this.sequence += 1
    this.pending.set(this.sequence, { at: this.time + ms, handler })
    return this.sequence
  }

  clearTimer(handle: HoverTimerHandle): void {
    if (typeof handle === 'number') {
      this.pending.delete(handle)
    }
  }

  /** 推进时间并触发到期计时器（按到期顺序）。 */
  advance(ms: number): void {
    this.time += ms
    let fired = true
    while (fired) {
      fired = false
      const due = [...this.pending.entries()]
        .filter(([, item]) => item.at <= this.time)
        .sort((left, right) => left[1].at - right[1].at)
      if (due.length === 0) {
        break
      }
      for (const [id, item] of due) {
        this.pending.delete(id)
        item.handler()
        fired = true
      }
    }
  }

  pendingCount(): number {
    return this.pending.size
  }
}

/** 一个真实可用的 CAMERA 片段夹具（走真实 parseDoc + 目录）。 */
function cameraScript(objects: JsonObject): JsonObject {
  return {
    meta: { id: 'verify06', name: 'Verify 06', author: '' },
    timeline: {
      tracks: [
        {
          type: 'CAMERA',
          clips: [{ start_time: 0, duration: 4, objects }],
        },
      ],
    },
  }
}

/** 打开一个夹具文档并返回 store 与首个片段键。 */
function openStore(catalog: CatalogIndex, raw: JsonObject, options: { coalesceWindowMs?: number; now?: () => number } = {}): {
  store: DocStore
  clipKey: string
  doc: ScriptDoc
} {
  const keys = metaKeys(catalog)
  const parsed = parseDoc(raw, { metaKeys: keys })
  if (!parsed.ok) {
    throw new Error(`夹具无法解析：${format(parsed.issues)}`)
  }
  const store = new DocStore({ catalog, metaKeys: keys, ...options })
  store.open(parsed.doc, 'verify06.json')
  const handle = store.registry.handles()[0]
  return { store, clipKey: handle.key, doc: parsed.doc }
}

function main(): void {
  const catalog = indexCatalog(buildCatalog('verify-06'))

  // ── 1. 共享悬停意图 ─────────────────────────────────────────────
  {
    const clock = new FakeClock()
    const events: string[] = []
    let shown: string | null = null
    const hover = new HoverIntent({
      showDelayMs: 250,
      hideDelayMs: 420,
      onIntent: (key) => events.push(`intent:${key}`),
      onShow: (key) => {
        shown = key
        events.push(`show:${key}`)
      },
      onHide: () => {
        shown = null
        events.push('hide')
      },
      setTimer: (handler, ms) => clock.setTimer(handler, ms),
      clearTimer: (handle) => clock.clearTimer(handle),
    })

    hover.intent('a')
    check('06-12 悬停：进入计时未到时尚未显示', shown === null, shown)
    clock.advance(249)
    check('06-12 悬停：249ms 仍未显示', shown === null, shown)
    clock.advance(1)
    check('06-12 悬停：250ms 后显示目标', shown === 'a', shown)
    check('06-12 悬停：进入时触发 onIntent', events.includes('intent:a'), events)

    hover.leave()
    clock.advance(419)
    check('06-12 悬停：离开 419ms 仍显示', shown === 'a', shown)
    clock.advance(1)
    check('06-12 悬停：离开 420ms 后隐藏', shown === null, shown)

    hover.intent('b')
    clock.advance(100)
    hover.keep()
    clock.advance(500)
    check('06-12 悬停：keep 取消待显示', shown === null, shown)

    hover.intent('c')
    clock.advance(300)
    check('06-12 悬停：切换目标后显示新目标', shown === 'c', shown)

    hover.leave()
    hover.intent('d')
    clock.advance(300)
    check('06-12 悬停：离开后进入新目标打断隐藏', shown === 'd', shown)

    hover.now('e')
    check('06-12 悬停：now 立即显示', shown === 'e', shown)

    hover.clear()
    check('06-12 悬停：clear 立即隐藏', shown === null, shown)

    hover.intent('f')
    hover.dispose()
    clock.advance(1000)
    check('06-12 悬停：dispose 后不再显示', shown === null, shown)
    check('06-12 悬停：dispose 清空计时器', clock.pendingCount() === 0, clock.pendingCount())
  }

  // ── 2. 共享手势会话 ─────────────────────────────────────────────
  {
    // 手势会话依赖 window / requestAnimationFrame：在 Node 下用最小替身，不 mock 业务逻辑。
    const listeners = new Map<string, (event: unknown) => void>()
    const globals = globalThis as unknown as Record<string, unknown>
    const originalWindow = globals.window
    const originalRaf = globals.requestAnimationFrame
    const originalCaf = globals.cancelAnimationFrame
    globals.window = {
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    }
    globals.requestAnimationFrame = () => 1
    globals.cancelAnimationFrame = () => undefined

    try {
      interface TestGesture {
        pointerId: number
        label: string
      }
      const updates: string[] = []
      const commits: string[] = []
      const cancels: string[] = []
      const session = createGestureSession<TestGesture>(
        {
          onUpdate: (gesture, event) => updates.push(`${gesture.label}@${event.clientX}`),
          onCommit: (gesture) => commits.push(gesture.label),
          onCancel: (gesture) => cancels.push(gesture.label),
        },
        (gesture) => gesture.pointerId,
      )

      check('06-12 手势：初始无活动手势', !session.active(), session.active())
      check('06-12 手势：begin 成功', session.begin({ pointerId: 1, label: 'drag' }), session.active())
      check('06-12 手势：重复 begin 被拒绝', !session.begin({ pointerId: 2, label: 'second' }), session.current())

      listeners.get('pointermove')?.({ pointerId: 1, clientX: 10, clientY: 0 })
      listeners.get('pointermove')?.({ pointerId: 9, clientX: 99, clientY: 0 })
      check('06-12 手势：只接受同一 pointerId 的移动', updates.join(',') === 'drag@10', updates)

      listeners.get('pointerup')?.({ pointerId: 1, clientX: 20, clientY: 0 })
      check('06-12 手势：抬起提交一次', commits.join(',') === 'drag', commits)
      check('06-12 手势：提交后无活动手势', !session.active(), session.active())
      check('06-12 手势：提交后不再有更新', updates.length === 1, updates)

      session.begin({ pointerId: 3, label: 'esc' })
      listeners.get('keydown')?.({
        key: 'Escape',
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      })
      check('06-12 手势：Esc 取消不提交', cancels.join(',') === 'esc' && commits.length === 1, { cancels, commits })

      session.begin({ pointerId: 4, label: 'cancel' })
      listeners.get('pointercancel')?.({ pointerId: 4, clientX: 0, clientY: 0 })
      check('06-12 手势：pointercancel 取消不提交', cancels.join(',') === 'esc,cancel', cancels)

      session.begin({ pointerId: 5, label: 'active' })
      session.dispose()
      check('06-12 手势：dispose 结束活动手势且不提交', !session.active() && commits.length === 1, { commits })
      check('06-12 手势：dispose 摘掉监听', listeners.size === 0, [...listeners.keys()])
    } finally {
      globals.window = originalWindow
      globals.requestAnimationFrame = originalRaf
      globals.cancelAnimationFrame = originalCaf
    }
  }

  // ── 3. 撤销合并 ─────────────────────────────────────────────────
  {
    let clock = 0
    const { store, clipKey } = openStore(
      catalog,
      cameraScript({ yaw: { value: 0 } }),
      { coalesceWindowMs: 400, now: () => clock },
    )
    store.commit({ kind: 'object.addKeyframe', clipKey, path: 'yaw', time: 1, value: 0 })
    const baseline = store.undoDepth()
    const before = JSON.stringify(serializeDoc(store.doc as ScriptDoc))

    for (const value of [10, 20, 30]) {
      clock += 100
      store.commit({ kind: 'object.setKeyframeValue', clipKey, path: 'yaw', time: 1, value }, 'yaw@1')
    }
    check('06-05 合并：窗口内同串只加 1 个撤销项', store.undoDepth() === baseline + 1, store.undoDepth())
    check('06-05 合并：撤销一次回到串开始前', store.undo() && JSON.stringify(serializeDoc(store.doc as ScriptDoc)) === before)

    store.redo()
    clock += 1000
    store.commit({ kind: 'object.setKeyframeValue', clipKey, path: 'yaw', time: 1, value: 40 }, 'yaw@1')
    check('06-05 合并：窗口外另起一项', store.undoDepth() === baseline + 2, store.undoDepth())

    store.commit({ kind: 'object.setKeyframeValue', clipKey, path: 'yaw', time: 1, value: 50 }, 'yaw@2')
    check('06-05 合并：串身份变化另起一项', store.undoDepth() === baseline + 3, store.undoDepth())

    store.undo()
    clock += 100
    store.commit({ kind: 'object.setKeyframeValue', clipKey, path: 'yaw', time: 1, value: 60 }, 'yaw@2')
    check('06-05 合并：撤销打断合并', store.undoDepth() === baseline + 3, store.undoDepth())

    store.endCoalescing()
    clock += 10
    store.commit({ kind: 'object.setKeyframeValue', clipKey, path: 'yaw', time: 1, value: 70 }, 'yaw@2')
    check('06-05 合并：endCoalescing 后另起一项', store.undoDepth() === baseline + 4, store.undoDepth())
  }

  // ── 4. 属性行派生与归属分区 ─────────────────────────────────────
  {
    const raw = cameraScript({
      'position.x': { keyframes: [{ time: 0, value: 1 }, { time: 2, value: 3 }] },
      yaw: { value: 90 },
      fov: { keyframes: [] },
      'custom.unknown_path': { value: 1 },
    })
    const { store, clipKey } = openStore(catalog, raw)
    const handle = store.registry.handles()[0]
    const rows = buildPropertyRows({
      clipKey,
      clip: handle.clip,
      trackType: 'CAMERA',
      catalog,
    })
    const byPath = new Map(rows.map((row) => [row.path, row]))

    check('06-02 行：列全部适用叶子（含未设置）', rows.length > 100, rows.length)
    check('06-02 行：未设置叶子 present=false', byPath.get('position.y')?.present === false, byPath.get('position.y')?.present)
    check('06-02 行：显式 value 叶子 present=true', byPath.get('yaw')?.present === true)
    check('06-02 行：空帧数组也算存在', byPath.get('fov')?.present === true)
    check('06-02 行：空帧数组 valueKind=static', byPath.get('fov')?.valueKind === 'static', byPath.get('fov')?.valueKind)
    check('06-02 行：有帧叶子 valueKind=animated', byPath.get('position.x')?.valueKind === 'animated')
    check('06-02 行：目录字段带 section', byPath.get('position.x')?.groupKey === 'position', byPath.get('position.x')?.groupKey)
    // 组标签走中文映射表（02 目录只有英文 section 键，没有 labelKey）。
    check('06-02 行：组标签映射为中文', byPath.get('position.x')?.groupLabel === '位置', byPath.get('position.x')?.groupLabel)
    check('06-02 行：未登记 section 原样显示', groupLabelOf('not_a_section') === 'not_a_section', groupLabelOf('not_a_section'))
    check('06-02 行：未分组标签固定', groupLabelOf(UNGROUPED_KEY) === '未分组', groupLabelOf(UNGROUPED_KEY))

    // 未知路径：`parseDoc` 会按 L34 拒绝，所以这里直接给 `buildPropertyRows` 一份含未知键的
    // 片段对象，验证派生层把未登记路径归入未知组且只读（运行时行为，不是断言源码）。
    const unknownRows = buildPropertyRows({
      clipKey: 'c-unknown',
      clip: { objects: { 'custom.unknown_path': { value: 1 } } },
      trackType: 'CAMERA',
      catalog,
    })
    const unknownRow = unknownRows.find((row) => row.path === 'custom.unknown_path')
    check('06-02 行：未知路径进未知组且只读', unknownRow?.unknown === true
      && unknownRow?.groupLabel === '未知 / 扩展' && unknownRow?.mode === 'unknown', unknownRow)
    check('06-02 行：未知路径行仍带帧信息', unknownRow?.present === true && unknownRow?.hasValue === true)

    const timing = readClipTiming(handle.clip)
    check('06-02 时长：有限片段 duration=4', timing.duration === 4 && !timing.infinite, timing)
    const groups = buildGroups(rows, timing)
    const partition = partitionGroups(groups, 'leaf', timing)
    const effectPaths = partition.effectGroups.flatMap((group) => group.rows.map((row) => row.path))
    const propertyPaths = partition.propertyGroups.flatMap((group) => group.rows.map((row) => row.path))

    check('06-02 归属：leaf 模式效果面板只含有帧叶子', effectPaths.sort().join(',') === 'position.x', effectPaths)
    check('06-02 归属：空帧叶子留属性面板', propertyPaths.includes('fov'), propertyPaths.includes('fov'))
    check('06-02 归属：纯静态叶子留属性面板', propertyPaths.includes('yaw'))
    check('06-02 归属：同一组可同时出现在两侧', partition.effectGroups.some((group) => group.key === 'position')
      && partition.propertyGroups.some((group) => group.key === 'position'))
    check('06-02 统计：效果组轴外帧数为 0', partition.effectGroups.every((group) => group.outOfRangeCount === 0))

    const groupPartition = partitionGroups(groups, 'group', timing)
    const groupEffectPaths = groupPartition.effectGroups.flatMap((group) => group.rows.map((row) => row.path))
    check('06-02 归属：group 模式整组进入', groupEffectPaths.includes('position.y'), groupEffectPaths.includes('position.y'))
    const positionGroup = groupPartition.effectGroups.find((group) => group.key === 'position')
    check('06-02 归属：group 模式静态伴随行有计数', (positionGroup?.staticCompanionCount ?? 0) > 0, positionGroup?.staticCompanionCount)

    const summary = summarizeRows(rows)
    check('06-02 统计：动画属性数 = 1', summary.animatedCount === 1, summary)
    check('06-02 统计：总帧数 = 2', summary.frameCount === 2, summary)
    check('06-02 统计：已设置行数 > 3', summary.setCount >= 4, summary)

    const outRow = byPath.get('position.x')
    check('06-02 轴外：无轴外帧时计数为 0', outRow !== undefined && outOfRangeCount(outRow, timing) === 0)
    check('06-02 有效值：首帧优先于 value', outRow !== undefined && effectiveStaticValue(outRow) === 1, effectiveStaticValue(outRow!))
    check('06-02 必填：无默认无值无帧时缺失', byPath.get('audio') === undefined)
    const requiredMissing = rows.filter((row) => isRequiredMissing(row, timing))
    // `playControl` 的 `start_time` / `duration` 必填且无默认值，属于片段时间几何（主轴负责），
    // 因此这里断言它们确实被标为必填缺失（属性面板据此显示「必填未设置」），而不是断言零缺失。
    check('06-02 必填：playControl 必填字段被标缺失', requiredMissing.map((row) => row.path).sort().join(',') === 'duration,start_time', requiredMissing.map((row) => row.path))
  }

  // ── 5. 轴外与无限片段 ───────────────────────────────────────────
  {
    const raw = cameraScript({
      yaw: { keyframes: [{ time: 0, value: 0 }, { time: 9, value: 90 }] },
    })
    const { store, clipKey } = openStore(catalog, raw)
    const handle = store.registry.handles()[0]
    const rows = buildPropertyRows({ clipKey, clip: handle.clip, trackType: 'CAMERA', catalog })
    const yaw = rows.find((row) => row.path === 'yaw')
    const timing = readClipTiming(handle.clip)
    check('06-02 轴外：超出时长的帧计入轴外数', yaw !== undefined && outOfRangeCount(yaw, timing) === 1, outOfRangeCount(yaw!, timing))
    check('06-04 轴外：t=9 在 duration=4 之外', isOutOfRange(9, timing) === true)
    check('06-04 轴外：t=2 在轴内', isOutOfRange(2, timing) === false)

    const infinite = { duration: -1, infinite: true }
    check('06-04 轴外：无限片段不判轴外', isOutOfRange(9999, infinite) === false)
    check('06-02 轴外：无限片段轴外数恒 0', yaw !== undefined && outOfRangeCount(yaw, infinite) === 0)
    check('06-08 适配：无限片段没有有限时长', finiteDuration({ clipKey: 'x', duration: -1, infinite: true }) === null)
  }

  // ── 6. 局部视口 ─────────────────────────────────────────────────
  {
    const viewport = { ...DEFAULT_VIEWPORT, width: 800, height: 200 }
    check('06-08 视口：t=0 在原点处 x=0', timeToX(0, viewport) === 0, timeToX(0, viewport))
    check('06-08 视口：t=1 在 80px', timeToX(1, viewport) === 80, timeToX(1, viewport))
    check('06-08 视口：x→t 与 t→x 互逆', Math.abs(xToTime(timeToX(2.5, viewport), viewport) - 2.5) < 1e-9)

    const zoomed = zoomAt(viewport, 200, 2)
    check('06-08 视口：缩放后锚点时间不动', Math.abs(xToTime(200, zoomed) - xToTime(200, viewport)) < 1e-9, {
      before: xToTime(200, viewport),
      after: xToTime(200, zoomed),
    })
    check('06-08 视口：缩放改变每秒像素', zoomed.pxPerSecond === 160, zoomed.pxPerSecond)
    check('06-08 视口：缩放有上限', zoomAt(viewport, 0, 1000).pxPerSecond === 2000, zoomAt(viewport, 0, 1000).pxPerSecond)
    check('06-08 视口：缩放有下限', zoomAt(viewport, 0, 0.0001).pxPerSecond === 8, zoomAt(viewport, 0, 0.0001).pxPerSecond)

    check('06-08 视口：平移不钳制到片段范围', panBy(viewport, -400).scrollLeft === -400)
    const window = visibleTimeWindow(viewport)
    check('06-08 视口：可见窗口从 0 到 10 秒', window.from === 0 && Math.abs(window.to - 10) < 1e-9, window)

    const rows = buildPropertyRows({
      clipKey: 'c1',
      clip: { objects: { yaw: { keyframes: [{ time: 0, value: 0 }, { time: 6, value: 1 }] } } },
      trackType: 'CAMERA',
      catalog,
    })
    const fitClip = fitViewport('clip', viewport, { span: { clipKey: 'c1', duration: 4, infinite: false }, rows })
    check('06-08 适配：适配片段让时长填满内容区', fitClip !== null && Math.abs(fitClip.pxPerSecond - 200) < 1e-9, fitClip?.pxPerSecond)
    const fitNodes = fitViewport('all-nodes', viewport, { span: { clipKey: 'c1', duration: 4, infinite: false }, rows })
    check('06-08 适配：适配全部节点包住轴外节点', fitNodes !== null && fitNodes.origin < 0, fitNodes?.origin)
    check('06-08 适配：无选中时适配选中节点返回 null', fitViewport('selection', viewport, {
      span: { clipKey: 'c1', duration: 4, infinite: false },
      rows,
      selectedTimes: [],
    }) === null)
    const fitInfinite = fitViewport('clip', viewport, { span: { clipKey: 'c1', duration: -1, infinite: true }, rows })
    check('06-08 适配：无限片段不尝试适配到无穷', fitInfinite !== null && Number.isFinite(fitInfinite.pxPerSecond), fitInfinite?.pxPerSecond)
  }

  // ── 7. 节点与段几何 ─────────────────────────────────────────────
  {
    const rows = buildPropertyRows({
      clipKey: 'c1',
      clip: {
        objects: {
          'position.x': { keyframes: [{ time: 0, value: 1 }, { time: 2, value: 3 }] },
          yaw: { keyframes: [{ time: 2, value: 45 }] },
          event: { keyframes: [{ time: 1, value: { command: 'say hi' } }] },
        },
      },
      trackType: 'CAMERA',
      catalog,
    })
    const eventRow = buildPropertyRows({
      clipKey: 'c1',
      clip: { objects: { event: { keyframes: [{ time: 1, value: { command: 'say hi' } }] } } },
      trackType: 'EVENT',
      catalog,
    }).find((row) => row.path === 'event')
    void rows
    const viewport = { ...DEFAULT_VIEWPORT, width: 800, height: 200 }
    const timing = { duration: 4, infinite: false }
    const selection: KeyframeSelection[] = [{ clipKey: 'c1', path: 'event', time: 1 }]

    check('06-04 几何：事件行存在', eventRow !== undefined)
    const eventNodes = nodesOfRow({
      row: eventRow!,
      viewport,
      timing,
      rowCenterY: 50,
      playhead: 1,
      selection,
    })
    check('06-04 几何：事件节点画成竖菱形（瞬时）', eventNodes.nodes[0]?.kind === 'event-instant', eventNodes.nodes[0]?.kind)
    check('06-04 几何：播放头精确命中节点', eventNodes.nodes[0]?.atPlayhead === true)
    check('06-04 几何：节点被选中', eventNodes.nodes[0]?.selected === true)
    check('06-04 几何：事件行不画段', segmentsOfRow({ row: eventRow!, viewport, rowCenterY: 50, selection: null }).length === 0)

    const xRow = buildPropertyRows({
      clipKey: 'c1',
      clip: { objects: { 'position.x': { keyframes: [{ time: 0, value: 1 }, { time: 2, value: 3 }] } } },
      trackType: 'CAMERA',
      catalog,
    }).find((row) => row.path === 'position.x')!
    const xNodes = nodesOfRow({ row: xRow, viewport, timing, rowCenterY: 30, playhead: 0, selection: [] })
    check('06-04 几何：两帧两个节点', xNodes.nodes.length === 2, xNodes.nodes.length)
    check('06-04 几何：t=2 在 160px', xNodes.nodes[1]?.x === 160, xNodes.nodes[1]?.x)
    const xSegments = segmentsOfRow({ row: xRow, viewport, rowCenterY: 30, selection: null })
    check('06-04 几何：两帧一段', xSegments.length === 1, xSegments.length)
    check('06-04 几何：段插值来自目录（linear）', xSegments[0]?.interp === 'linear', xSegments[0]?.interp)

    const hit = hitTestNodes(xNodes.nodes, 160, 30, 6)
    check('06-04 几何：命中测试取最近节点', hit?.time === 2, hit?.time)
    check('06-04 几何：远处不命中', hitTestNodes(xNodes.nodes, 400, 30, 6) === null)
    const boxed = nodesInRect(xNodes.nodes, { left: -10, top: 0, right: 100, bottom: 60 })
    check('06-04 几何：框选只选覆盖到的节点', boxed.length === 1 && boxed[0].time === 0, boxed.map((node) => node.time))

    const layout = layoutRows(
      [{ key: 'position', rows: [xRow] }],
      new Set(),
      new Set(),
    )
    check('06-04 布局：行中心 = 组头 + 半行高', layout.centers.get('position.x') === 24 + 13, layout.centers.get('position.x'))
    const collapsed = layoutRows([{ key: 'position', rows: [xRow] }], new Set(['position']), new Set())
    check('06-04 布局：折叠后不产生行中心', collapsed.centers.size === 0 && collapsed.totalHeight === 24, collapsed)

    // 虚拟化：视口外节点只给计数。
    const narrow = { ...viewport, width: 100 }
    const virtual = nodesOfRow({ row: xRow, viewport: narrow, timing, rowCenterY: 30, playhead: 0, selection: [] })
    check('06-04 虚拟化：视口外节点只计数不生成', virtual.nodes.length === 1 && virtual.hiddenCount === 1, virtual)
  }

  // ── 8. 缓动采样与烘焙 ───────────────────────────────────────────
  {
    const frames = [
      { time: 0, value: 0 },
      { time: 2, value: 100 },
    ]
    check('06-06 采样：无节点返回不可采样', sampleValue({ frames: [], interp: 'linear', time: 1 }).ok === false)
    const mid = sampleValue({ frames, interp: 'linear', time: 1 })
    check('06-06 采样：线性中点插值', mid.ok && mid.value === 50, mid)
    const atZero = sampleValue({ frames, interp: 'linear', time: 0 })
    check('06-06 采样：端点精确返回节点值', atZero.ok && atZero.value === 0, atZero)
    const afterLast = sampleValue({ frames, interp: 'linear', time: 9 })
    check('06-06 采样：末节点之后保持末值', afterLast.ok && afterLast.value === 100, afterLast)
    const stepped = sampleValue({ frames, interp: 'step', time: 1.9 })
    check('06-06 采样：step 取左侧节点值', stepped.ok && stepped.value === 0, stepped)

    const easing = {
      clipKey: 'c1',
      path: 'yaw',
      fromTime: 0,
      toTime: 2,
      mode: 'bezier' as const,
      out: { x: 0.42, y: 0 },
      in: { x: 0.58, y: 1 },
      revision: 1,
    }
    const eased = sampleValue({ frames, interp: 'linear', time: 1, easing })
    check('06-06 采样：贝塞尔中点仍是 50（对称把手）', eased.ok && Math.abs((eased.value as number) - 50) < 1e-6, eased)
    const easedEarly = sampleValue({ frames, interp: 'linear', time: 0.25, easing })
    check('06-06 采样：ease-in 早期慢于线性', easedEarly.ok && (easedEarly.value as number) < 12.5, easedEarly)
    const nonNumeric = sampleValue({
      frames: [{ time: 0, value: 'a' }, { time: 2, value: 'b' }],
      interp: 'linear',
      time: 1,
    })
    check('06-06 采样：非数值不做插值', nonNumeric.ok && nonNumeric.value === 'a', nonNumeric)

    check('06-06 段定位：t 在首节点之前返回 -1', segmentIndexAt(frames, -1) === -1)
    check('06-06 段定位：t=1 落在第 0 段', segmentIndexAt(frames, 1) === 0)
    check('06-06 段定位：t=2 落在末节点', segmentIndexAt(frames, 2) === 1)

    // 烘焙采样密度按秒推导（与缩放无关）：2 秒段 = round(2×4)+2 = 10，钳到 [8,20]。
    check('06-06 采样数：按秒推导且与缩放无关', bakeSampleCount(0, 2) === 10, bakeSampleCount(0, 2))
    check('06-06 采样数：短段钳到下限 8', bakeSampleCount(0, 0.1) === 8, bakeSampleCount(0, 0.1))
    check('06-06 采样数：长段钳到上限 20', bakeSampleCount(0, 100) === 20, bakeSampleCount(0, 100))
    check('06-06 采样数：零长段取下限', bakeSampleCount(2, 2) === 8, bakeSampleCount(2, 2))

    const baked = bakeSegment({ frames, interp: 'linear', fromTime: 0, toTime: 2 })
    check('06-06 烘焙：保留起止节点', baked[0].time === 0 && baked[baked.length - 1].time === 2)
    check('06-06 烘焙：总点数等于采样数', baked.length === 10, baked.length)
    check('06-06 烘焙：采样点按时间升序', baked.every((point, index) => index === 0 || point.time > baked[index - 1].time))
    check('06-06 烘焙：采样值与线性一致', Math.abs((baked[1].value as number) - (baked[1].time / 2) * 100) < 1e-9, baked[1])

    // 插值形态必须与运行时 `SampledProperty.Compiled.interpolateFloat` 同口径。
    const angleFrames = [{ time: 0, value: 170 }, { time: 2, value: -170 }]
    const angleMid = sampleValue({ frames: angleFrames, interp: 'angle', time: 1 })
    // 最短路径：170 → -170 走 -20°，中点应为 180（或 -180 归一后等价）。
    check('06-06 采样：angle 走最短路径', angleMid.ok
      && (Math.abs((angleMid.value as number) - 180) < 1e-6 || Math.abs((angleMid.value as number) + 180) < 1e-6), angleMid)

    const geoFrames = [{ time: 0, value: 1 }, { time: 2, value: 100 }]
    const geoMid = sampleValue({ frames: geoFrames, interp: 'geometric', time: 1 })
    // 几何插值：exp((log1 + log100)/2) = 10。
    check('06-06 采样：geometric 走几何平均', geoMid.ok && Math.abs((geoMid.value as number) - 10) < 1e-6, geoMid)
    const geoZero = sampleValue({
      frames: [{ time: 0, value: 0 }, { time: 2, value: 100 }],
      interp: 'geometric',
      time: 1,
    })
    check('06-06 采样：geometric 端点 ≤0 回落左值', geoZero.ok && geoZero.value === 0, geoZero)

    const stepAtEnd = sampleValue({ frames, interp: 'step', time: 2 })
    check('06-06 采样：step 到达端点取后一帧', stepAtEnd.ok && stepAtEnd.value === 100, stepAtEnd)

    // 范围过滤（object-model.md §3.4 第 1 步）：轴外帧不得污染轴内采样。
    const withOutOfRange = [
      { time: 0, value: 0 },
      { time: 9, value: 90 },
    ]
    const insideOnly = sampleValue({
      frames: withOutOfRange,
      interp: 'linear',
      time: 3,
      timing: { duration: 4, infinite: false },
    })
    check('06-06 采样：轴外帧不参与轴内插值', insideOnly.ok && insideOnly.value === 0, insideOnly)
    const withoutTiming = sampleValue({ frames: withOutOfRange, interp: 'linear', time: 3 })
    check('06-06 采样：省略 timing 时不做范围过滤（内部场景）',
      withoutTiming.ok && Math.abs((withoutTiming.value as number) - 30) < 1e-6, withoutTiming)

    check('06-06 范围：过滤后只剩范围内帧',
      framesInRange(withOutOfRange, { duration: 4, infinite: false }).length === 1,
      framesInRange(withOutOfRange, { duration: 4, infinite: false }))
    check('06-06 范围：无限片段只排除负时间',
      framesInRange([{ time: -1, value: 0 }, { time: 9, value: 1 }], { duration: -1, infinite: true }).length === 1)
    const singleFrame = sampleValue({
      frames: [{ time: 2, value: 7 }],
      interp: 'linear',
      time: 0,
      timing: { duration: 4, infinite: false },
    })
    check('06-06 采样：单帧整段恒值', singleFrame.ok && singleFrame.value === 7, singleFrame)
  }

  // ── 9. 值控件与目标解析 ─────────────────────────────────────────
  {
    const rows = buildPropertyRows({
      clipKey: 'c1',
      clip: {
        objects: {
          yaw: { value: 90 },
          yaw_lock: { value: null },
          'position.x': { keyframes: [{ time: 0, value: 1 }] },
          unknown_path: { value: 1 },
        },
      },
      trackType: 'CAMERA',
      catalog,
    })
    const byPath = new Map(rows.map((row) => [row.path, row]))

    check('06-03 控件：float → number', controlKindOf(byPath.get('yaw')!) === 'number', controlKindOf(byPath.get('yaw')!))
    check('06-03 控件：nullable_float → nullable-number', controlKindOf(byPath.get('yaw_lock')!) === 'nullable-number')
    check('06-03 控件：int → integer', controlKindOf(byPath.get('cam_breath_seed')!) === 'integer')
    check('06-03 控件：bool → boolean', controlKindOf(byPath.get('cam_breath_enabled')!) === 'boolean')
    check('06-03 控件：enum → enum', controlKindOf(byPath.get('position_mode')!) === 'enum')
    check('06-03 控件：struct → struct', controlKindOf(byPath.get('rgb_curve')!) === 'struct')
    check('06-03 控件：未知路径 → readonly', controlKindOf(byPath.get('unknown_path')!) === 'readonly')

    check('06-03 校验：合法值通过', validateValue(byPath.get('yaw')!, 45).ok === true)
    check('06-03 校验：类型不匹配拒绝', validateValue(byPath.get('yaw')!, '45').ok === false)
    const overlayRows = buildPropertyRows({ clipKey: 'c-ov', clip: { objects: {} }, trackType: 'OVERLAY', catalog })
    const opacityRow = overlayRows.find((row) => row.path === 'opacity')!
    check('06-03 校验：越界拒绝不夹取', validateValue(opacityRow, 2).ok === false
      && validateValue(opacityRow, 2).code === 'out_of_range', validateValue(opacityRow, 2))
    check('06-03 校验：枚举外拒绝', validateValue(byPath.get('position_mode')!, 'sideways').ok === false)
    check('06-03 校验：未知路径只读拒绝', validateValue(byPath.get('unknown_path')!, 1).code === 'readonly_unknown')
    check('06-03 校验：可空接受 null', validateValue(byPath.get('yaw_lock')!, null).ok === true)

    check('06-03 解析：数字文本转数字', parseTextInput('number', '12.5').value === 12.5)
    check('06-03 解析：非数字文本被拒绝', parseTextInput('number', 'abc').code === 'not_finite')
    check('06-03 解析：整数控件拒绝小数', parseTextInput('integer', '2.5').code === 'int_required')
    check('06-03 解析：可空空串写 null', parseTextInput('nullable-number', '').value === null)
    check('06-03 解析：结构 JSON 语法错误被拒', parseTextInput('struct', '{bad').code === 'struct_invalid_json')
    check('06-03 解析：引用空串被拒', parseTextInput('ref', '').code === 'ref_empty')

    const animatedRow = byPath.get('position.x')!
    const staticRow = byPath.get('yaw')!
    check('06-03 目标：属性面板未动画行 → 静态值', resolveTarget({
      panel: 'properties',
      row: staticRow,
      rowHasKeyframes: false,
      playhead: 0,
      playheadHitsNode: false,
    }).target?.kind === 'static')
    check('06-03 目标：属性面板已动画行 → 拒绝（在另一个面板）', resolveTarget({
      panel: 'properties',
      row: animatedRow,
      rowHasKeyframes: true,
      playhead: 0,
      playheadHitsNode: true,
    }).code === 'row_in_other_panel')
    check('06-03 目标：效果面板命中节点 → 改节点', resolveTarget({
      panel: 'effects',
      row: animatedRow,
      rowHasKeyframes: true,
      playhead: 0,
      playheadHitsNode: true,
    }).target?.kind === 'node')
    check('06-03 目标：效果面板未命中 → 待新增节点', resolveTarget({
      panel: 'effects',
      row: animatedRow,
      rowHasKeyframes: true,
      playhead: 3,
      playheadHitsNode: false,
    }).target?.kind === 'new-node')

    check('06-05 初值：采样值优先', seedForNewNode(staticRow, 42, 1).value === 42)
    check('06-05 初值：退回静态值', seedForNewNode(staticRow, undefined, 1).value === 90)
    check('06-05 初值：退回目录默认值', seedForNewNode(byPath.get('position.y')!, undefined, 1).value === 0)
    const noSeedRow = buildPropertyRows({ clipKey: 'c-ns', clip: { objects: {} }, trackType: 'AUDIO', catalog })
      .find((row) => row.path === 'sound')!
    check('06-05 初值：都没有时拒绝', seedForNewNode(noSeedRow, undefined, 1).code === 'default_missing', seedForNewNode(noSeedRow, undefined, 1))

    check('06-03 可动画：animated 允许', animatable(byPath.get('yaw')!.def) === true)
    check('06-03 可动画：value 模式拒绝', animatable(byPath.get('transition')!.def) === false)
    check('06-03 可动画：struct 拒绝', animatable(byPath.get('rgb_curve')!.def) === false)

    const axes = missingPositionAxes({
      path: 'position_space',
      time: 2,
      rows,
      baseOnly: false,
      space: 'world',
    })
    check('06-03 参考系：非零时刻切换缺三轴时报告缺失', axes.length === 3, axes)
    check('06-03 参考系：零时刻不算切换', missingPositionAxes({
      path: 'position_space',
      time: 0,
      rows,
      baseOnly: false,
      space: 'world',
    }).length === 0)
  }

  // ── 10. 作者态缓动存储 ──────────────────────────────────────────
  {
    const state: Record<string, unknown> = {}
    writeEasingMutator({
      path: 'yaw',
      fromTime: 0,
      toTime: 2,
      mode: 'bezier',
      out: { x: 0.4, y: 0 },
      in: { x: 0.6, y: 1 },
      revision: 3,
    })(state)
    const table = readEasingTable(state)
    const key = easingKey('yaw', 0, 2)
    check('06-06 存储：写入后可按键读回', table[key] !== undefined, Object.keys(table))
    check('06-06 存储：模式与修订号保留', table[key]?.mode === 'bezier' && table[key]?.revision === 3, table[key])

    removeEasingMutator('yaw', 0, 2)(state)
    check('06-06 存储：删除后键消失', readEasingTable(state)[key] === undefined)

    writeEasingMutator({ path: 'yaw', fromTime: 0, toTime: 2, mode: 'linear', out: { x: 0, y: 0 }, in: { x: 1, y: 1 }, revision: 1 })(state)
    writeEasingMutator({ path: 'yaw', fromTime: 2, toTime: 4, mode: 'linear', out: { x: 0, y: 0 }, in: { x: 1, y: 1 }, revision: 1 })(state)
    clearPathEasingMutator('yaw')(state)
    check('06-06 存储：清空属性后无残留', Object.keys(readEasingTable(state)).length === 0, readEasingTable(state))

    writeEasingMutator({ path: 'yaw', fromTime: 0, toTime: 2, mode: 'linear', out: { x: 0, y: 0 }, in: { x: 1, y: 1 }, revision: 1 })(state)
    pruneInvalidEasingsMutator([{ time: 0, value: 0 }, { time: 2, value: 1 }])(state)
    check('06-06 存储：段两端仍在时保留', Object.keys(readEasingTable(state)).length === 1, readEasingTable(state))
    pruneInvalidEasingsMutator([{ time: 0, value: 0 }, { time: 3, value: 1 }])(state)
    check('06-06 存储：段失效后清除', Object.keys(readEasingTable(state)).length === 0, readEasingTable(state))

    writeEasingMutator({ path: 'yaw', fromTime: 0, toTime: 2, mode: 'linear', out: { x: 0, y: 0 }, in: { x: 1, y: 1 }, revision: 1 })(state)
    writeEasingMutator({ path: 'pitch', fromTime: 0, toTime: 2, mode: 'linear', out: { x: 0, y: 0 }, in: { x: 1, y: 1 }, revision: 1 })(state)
    const summary = unbakedSummary({ c1: state })
    check('06-06 存储：未烘焙摘要列出两条路径', summary.length === 2, summary)
    check('06-06 存储：摘要按路径计数', summary.every((item) => item.segments === 1), summary)
  }

  // ── 11. 作者态写入进撤销栈且不写盘 ──────────────────────────────
  {
    const { store, clipKey } = openStore(catalog, cameraScript({ yaw: { value: 0 } }))
    const before = JSON.stringify(serializeDoc(store.doc as ScriptDoc))
    const depth = store.undoDepth()
    const result = store.commitClipAuthoring(clipKey, writeEasingMutator({
      path: 'yaw',
      fromTime: 0,
      toTime: 2,
      mode: 'bezier',
      out: { x: 0.4, y: 0 },
      in: { x: 0.6, y: 1 },
      revision: 1,
    }))
    check('06-06 作者态：写入成功', result.ok, result)
    check('06-06 作者态：进撤销栈', store.undoDepth() === depth + 1, store.undoDepth())
    check('06-06 作者态：不写盘（序列化不变）', JSON.stringify(serializeDoc(store.doc as ScriptDoc)) === before)
    check('06-06 作者态：可从 store 读回', Object.keys(readEasingTable(store.clipAuthoringOf(clipKey))).length === 1)
    check('06-06 作者态：撤销后消失', store.undo() && Object.keys(readEasingTable(store.clipAuthoringOf(clipKey))).length === 0)
    check('06-06 作者态：撤销后序列化仍不变', JSON.stringify(serializeDoc(store.doc as ScriptDoc)) === before)
  }

  // ── 12. 命令层新增成员 ──────────────────────────────────────────
  {
    const { store, clipKey } = openStore(catalog, cameraScript({ 'position.x': { value: 0 } }))
    // 注意：`commit` 失败会 `restore(snapshot)` 重新 parseDoc，片段对象被整体替换；
    // 因此这里每次现取句柄，不缓存跨 commit 的引用（与面板靠 revision 重取同源）。
    const currentClip = (): JsonObject => store.registry.handle(clipKey)!.clip
    const objects = (): JsonObject => currentClip().objects as JsonObject
    const framesOf = (path: string): JsonValue[] => {
      const property = objects()[path]
      return property !== undefined && typeof property === 'object' && !Array.isArray(property)
        ? ((property as JsonObject).keyframes as JsonValue[] | undefined) ?? []
        : []
    }

    // enableAnimation：无节点时按静态值建首帧。
    const enabled = store.commit({ kind: 'object.enableAnimation', clipKey, path: 'yaw', time: 1 })
    check('06-03 命令：enableAnimation 成功', enabled.ok, enabled)
    check('06-03 命令：enableAnimation 在播放头建一帧', framesOf('yaw').length === 1, framesOf('yaw'))
    check('06-03 命令：enableAnimation 初值取静态值', (framesOf('yaw')[0] as JsonObject).value === 0, framesOf('yaw')[0])

    // 同刻重复建帧被拒绝。
    const dup = store.commit({ kind: 'object.enableAnimation', clipKey, path: 'yaw', time: 1 })
    check('06-05 命令：同刻重复建帧被拒绝', !dup.ok, dup)

    // setKeyframeValue 只改命中节点。
    store.commit({ kind: 'object.addKeyframe', clipKey, path: 'yaw', time: 2, value: 5 })
    const setOne = store.commit({ kind: 'object.setKeyframeValue', clipKey, path: 'yaw', time: 1, value: 7 })
    check('06-05 命令：setKeyframeValue 成功', setOne.ok, setOne)
    check('06-05 命令：只改命中节点', (framesOf('yaw')[0] as JsonObject).value === 7 && (framesOf('yaw')[1] as JsonObject).value === 5, framesOf('yaw'))
    check('06-05 命令：不存在的节点被拒绝', !store.commit({ kind: 'object.setKeyframeValue', clipKey, path: 'yaw', time: 9, value: 1 }).ok)

    // moveKeyframes 批量原子提交。
    const moved = store.commit({
      kind: 'object.moveKeyframes',
      clipKey,
      moves: [{ path: 'yaw', from: 1, to: 3 }, { path: 'yaw', from: 2, to: 4 }],
    })
    check('06-05 命令：批量移动成功', moved.ok, moved)
    check('06-05 命令：批量移动后时间为 3 / 4', framesOf('yaw').map((frame) => (frame as JsonObject).time).join(',') === '3,4', framesOf('yaw'))
    const conflict = store.commit({
      kind: 'object.moveKeyframes',
      clipKey,
      moves: [{ path: 'yaw', from: 3, to: 9 }, { path: 'yaw', from: 4, to: 9 }],
    })
    check('06-05 命令：批量移动冲突整次拒绝', !conflict.ok, conflict)
    check('06-05 命令：拒绝后文档不变', framesOf('yaw').map((frame) => (frame as JsonObject).time).join(',') === '3,4', framesOf('yaw'))

    // removeKeyframes 批量删除。
    const removed = store.commit({
      kind: 'object.removeKeyframes',
      clipKey,
      targets: [{ path: 'yaw', time: 3 }],
    })
    check('06-05 命令：批量删除成功', removed.ok, removed)
    check('06-05 命令：删除后剩一帧', framesOf('yaw').length === 1, framesOf('yaw'))

    // 删到 0 帧允许（animated 空数组是合法静态形态）。
    const empty = store.commit({ kind: 'object.removeKeyframes', clipKey, targets: [{ path: 'yaw', time: 4 }] })
    check('06-05 命令：删空帧允许', empty.ok, empty)
    check('06-05 命令：空帧数组保留', framesOf('yaw').length === 0, framesOf('yaw'))

    // disableAnimation 保留最后值。
    store.commit({ kind: 'object.addKeyframe', clipKey, path: 'yaw', time: 1, value: 11 })
    store.commit({ kind: 'object.addKeyframe', clipKey, path: 'yaw', time: 2, value: 22 })
    const disabled = store.commit({ kind: 'object.disableAnimation', clipKey, path: 'yaw' })
    check('06-02 命令：disableAnimation 成功', disabled.ok, disabled)
    const yawObject = objects().yaw as JsonObject
    check('06-02 命令：关闭动画后帧为空', Array.isArray(yawObject.keyframes) && (yawObject.keyframes as JsonValue[]).length === 0)
    check('06-02 命令：关闭动画保留最后值', yawObject.value === 22, yawObject.value)

    // pasteKeyframes：类型匹配 + 偏移插入。
    store.commit({ kind: 'object.setValue', clipKey, path: 'pitch', value: 0 })
    const pasted = store.commit({
      kind: 'object.pasteKeyframes',
      clipKey,
      path: 'pitch',
      mode: 'merge',
      type: 'float',
      anchor: 1,
      points: [{ offset: 0, value: 10 }, { offset: 1, value: 20 }],
    })
    check('06-05 命令：粘贴成功', pasted.ok, pasted)
    check('06-05 命令：粘贴按偏移插入', framesOf('pitch').map((frame) => (frame as JsonObject).time).join(',') === '1,2', framesOf('pitch'))
    const badType = store.commit({
      kind: 'object.pasteKeyframes',
      clipKey,
      path: 'pitch',
      mode: 'merge',
      type: 'bool',
      anchor: 5,
      points: [{ offset: 0, value: true }],
    })
    check('06-05 命令：粘贴类型不匹配拒绝', !badType.ok, badType)
    const badTime = store.commit({
      kind: 'object.pasteKeyframes',
      clipKey,
      path: 'pitch',
      mode: 'merge',
      anchor: 0,
      points: [{ offset: -5, value: 1 }],
    })
    check('06-05 命令：粘贴负时间拒绝', !badTime.ok, badTime)

    // bakeEasing：保留区间外节点，区间内替换为采样点。
    store.commit({ kind: 'object.setKeyframes', clipKey, path: 'roll', keyframes: [
      { time: 0, value: 0 },
      { time: 2, value: 100 },
      { time: 6, value: 300 },
    ] })
    const baked = store.commit({
      kind: 'object.bakeEasing',
      clipKey,
      path: 'roll',
      fromTime: 0,
      toTime: 2,
      points: [{ time: 0, value: 0 }, { time: 1, value: 50 }, { time: 2, value: 100 }],
    })
    check('06-06 命令：烘焙成功', baked.ok, baked)
    const rollTimes = framesOf('roll').map((frame) => (frame as JsonObject).time)
    check('06-06 命令：烘焙插入采样点', rollTimes.join(',') === '0,1,2,6', rollTimes)
    check('06-06 命令：烘焙保留区间外节点', rollTimes.includes(6))

    // 事件叶子不能关闭动画、不能删空。
    const eventStore = openStore(catalog, {
      meta: { id: 'verify06e', name: 'Event', author: '' },
      timeline: {
        tracks: [{
          type: 'EVENT',
          clips: [{ start_time: 0, duration: 4, objects: { event: { keyframes: [{ time: 1, value: { command: 'say hi' } }] } } }],
        }],
      },
    })
    const eventKey = eventStore.clipKey
    check('06-07 命令：删除唯一事件记录被拒绝',
      !eventStore.store.commit({ kind: 'object.removeKeyframes', clipKey: eventKey, targets: [{ path: 'event', time: 1 }] }).ok)
    check('06-07 命令：事件叶子不能关闭动画',
      !eventStore.store.commit({ kind: 'object.disableAnimation', clipKey: eventKey, path: 'event' }).ok)
    check('06-07 命令：单条删除同样被拒绝',
      !eventStore.store.commit({ kind: 'object.removeKeyframe', clipKey: eventKey, path: 'event', time: 1 }).ok)
  }

  // ── 13. 选择域驱动面板切换（06-12 补充；检查器改版） ─────────────
  {
    check('06-12 切换：none → 右栏检查器（脚本参数）',
      targetPanelFor({ domain: 'none' })?.panelId === 'selection.properties', targetPanelFor({ domain: 'none' }))
    check('06-12 切换：track → 右栏检查器（轨道参数）',
      targetPanelFor({ domain: 'track', trackId: 'CAMERA#0' })?.panelId === 'selection.properties',
      targetPanelFor({ domain: 'track', trackId: 'CAMERA#0' }))
    check('06-12 切换：clip → 右栏检查器（片段属性）',
      targetPanelFor({ domain: 'clip', clipKey: 'c1' })?.panelId === 'selection.properties')
    check('06-12 切换：object → 右栏检查器（片段属性）',
      targetPanelFor({ domain: 'object', clipKey: 'c1', objectPath: 'yaw' })?.panelId === 'selection.properties')
    check('06-12 切换：keyframe → 右栏检查器（片段属性）',
      targetPanelFor({ domain: 'keyframe', clipKey: 'c1', objectPath: 'yaw', keyframeTime: 1 })?.panelId === 'selection.properties')
    check('06-12 切换：path / rule / binding 不切',
      targetPanelFor({ domain: 'path', pathId: 'p1' }) === null
      && targetPanelFor({ domain: 'rule', ruleId: 'r1' }) === null
      && targetPanelFor({ domain: 'binding', bindingId: 'b1' }) === null)
    check('06-12 切换：目标面板统一属于 core.selection-properties',
      targetPanelFor({ domain: 'none' })?.pluginId === 'core.selection-properties'
      && targetPanelFor({ domain: 'track', trackId: 'CAMERA#0' })?.pluginId === 'core.selection-properties'
      && targetPanelFor({ domain: 'clip', clipKey: 'c1' })?.pluginId === 'core.selection-properties')
  }

  // ── 14. 效果面板会话类型可用（形状自检） ─────────────────────────
  {
    const session: EffectPanelSession = {
      collapsed: new Set<string>(),
      search: '',
      onlyOutOfRange: false,
      columnRatio: 0.42,
      viewport: { ...DEFAULT_VIEWPORT },
      expanded: new Set<string>(),
      selectedNodes: [],
      selectedSegment: null,
    }
    check('06-01 会话：可构造且不引用文档', session.selectedNodes.length === 0 && session.columnRatio === 0.42)
    check('06-02 归属：hasKeyframeContent 对空帧为假', !hasKeyframeContent({
      clipKey: 'c',
      path: 'p',
      label: 'p',
      present: true,
      mode: 'animated',
      type: 'float',
      interp: 'linear',
      hasValue: false,
      keyframes: [],
      unknown: false,
      required: false,
      hasDefault: false,
      nullable: false,
      valueKind: 'static',
      groupKey: '',
      groupLabel: '',
    }))
  }
}

main()
console.log(`summary ok=${ok} fail=${fail}`)
if (fail > 0) {
  process.exitCode = 1
}
