<script setup lang="ts">
/**
 * 调色曲线编辑器（08-01 §三 / §4.3）：CAMERA 10 条调色曲线共用同一份控制点表。
 *
 * 口径（全部来自 02 目录与既有纯函数，本组件不另建字段表、不另写校验）：
 * - 曲线路径与条目由 `cameraCurveEntries(catalog)` 推导（`section=color` 且 `type=struct`）；
 * - 控制点合法性走 `curveValueOf` / `curvePointsProblem` / `curvePointsToJson`，
 *   越界、乱序、非有限数字只报错，不夹紧、不自动重排；
 * - 行归属：`keyframes` 非空的叶子已搬去效果面板，这里只用 `staticRows` 过滤；
 * - 写入只走 `usePanelContext().commands.commit`：
 *   整条曲线 `object.setValue`，清空（0 点）`object.remove`；同一串编辑共用一个
 *   `coalesceWith` 身份，撤销不碎成多条；失败显示错误、草稿保留、文档与撤销栈不动。
 *
 * 窄面板下表默认收起，点"展开控制点表"后以绝对定位浮层叠在组内；浮层自身可滚动，
 * 宽度不足以承载浮层时退化为组内联展开；浮层打开期间 Esc 关闭。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { FieldEntry } from '../../../core/schema/types.ts'
import type { JsonValue } from '../../../core/doc/types.ts'
import type { PropertyRow } from '../../effects/types.ts'
import { labelOf } from '../../effects/rows.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import {
  cameraCurveEntries,
  curvePointsProblem,
  curvePointsToJson,
  curveValueOf,
  staticRows,
  type CameraEditorInput,
  type CurvePoint,
} from '../fieldSurface.ts'

const props = defineProps<CameraEditorInput>()

const ctx = usePanelContext()

/** 表内一个控制点的草稿（字符串形态；提交前才解析为有限数字）。 */
interface DraftPoint {
  x: string
  y: string
}

/** 画布归一化尺寸（viewBox 坐标，不随面板宽度变形）。 */
const SHEET_WIDTH = 200
const SHEET_HEIGHT = 132
const SHEET_PADDING = 14

/** 宽度小于该阈值视为窄面板：控制点表优先走浮层承载。 */
const NARROW_MIN_WIDTH = 280

const rootEl = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

/** 当前根元素宽度（窄面板判定用；ResizeObserver 不可用时保持宽态）。 */
const rootWidth = ref<number>(Number.POSITIVE_INFINITY)
const narrow = computed(() => rootWidth.value < NARROW_MIN_WIDTH)

/** 当前选中曲线路径；`null` 表示目录里没有可编辑曲线。 */
const selectedPath = ref<string | null>(null)

/** 控制点表是否展开（收起时只留曲线列表与示意）。 */
const sheetOpen = ref(false)

/** 本组件本次操作的报错（提交失败 / 草稿非法）。 */
const localError = ref('')

/** 草稿是否被本地改过（改过之后在提交成功前不跟随文档重置）。 */
const draftDirty = ref(false)

/** 草稿控制点（字符串；与文档解耦，提交成功后再同步）。 */
const draftPoints = reactive<DraftPoint[]>([])

// ── 曲线条目与行归属 ────────────────────────────────────────────────

/** 目录推导的全部曲线条目（顺序即目录顺序，不手抄清单）。 */
const entries = computed<FieldEntry[]>(() => cameraCurveEntries(props.catalog))

/** 留在属性面板的静态曲线行（已打帧的叶子归效果面板，不在两处同时出现）。 */
const staticRowsMap = computed<Map<string, PropertyRow>>(() => {
  const map = new Map<string, PropertyRow>()
  for (const row of staticRows(props.rows)) {
    map.set(row.path, row)
  }
  return map
})

/**
 * 列表实际展示的曲线：目录条目里仍留在属性面板的行。
 * 调用方尚未传行集合（空 `rows`）时回退到目录全集，避免面板空挂。
 */
const visibleEntries = computed<FieldEntry[]>(() => {
  const rows = staticRowsMap.value
  if (rows.size === 0) {
    return entries.value
  }
  return entries.value.filter((entry) => rows.has(entry.key))
})

/** 路径 → 条目。 */
const entryByPath = computed<Map<string, FieldEntry>>(() => {
  const map = new Map<string, FieldEntry>()
  for (const entry of visibleEntries.value) {
    map.set(entry.key, entry)
  }
  return map
})

const selectedEntry = computed<FieldEntry | undefined>(() => {
  const path = selectedPath.value
  if (path === null) {
    return undefined
  }
  return entryByPath.value.get(path)
})

/** 文档里该曲线的解析结果（未设置 / 已设置但非法 / 合法控制点）。 */
function docStatusOf(path: string): { present: boolean; points: CurvePoint[]; problem: string | null } {
  return curveValueOf(props.objects, path)
}

const selectedStatus = computed(() => {
  const path = selectedPath.value
  if (path === null) {
    return { present: false, points: [] as CurvePoint[], problem: null }
  }
  return docStatusOf(path)
})

/** 列表项状态：已设置 / 未设置 / 文档值非法。 */
function stateOf(path: string): 'set' | 'unset' | 'invalid' {
  const status = docStatusOf(path)
  if (!status.present) {
    return 'unset'
  }
  return status.problem === null ? 'set' : 'invalid'
}

/** 条目展示标签：行标签优先，其次目录 `labelKey`，再回退路径末段（与 06 `labelOf` 同口径）。 */
function labelOfEntry(entry: FieldEntry): string {
  const row = staticRowsMap.value.get(entry.key)
  if (row !== undefined) {
    return row.label
  }
  return labelOf(entry.key, entry)
}

// ── 草稿同步与本地校验 ──────────────────────────────────────────────

function pointsToDraft(points: readonly CurvePoint[]): DraftPoint[] {
  return points.map((point) => ({ x: String(point.x), y: String(point.y) }))
}

function syncDraft(): void {
  draftPoints.splice(0, draftPoints.length, ...pointsToDraft(selectedStatus.value.points))
  draftDirty.value = false
}

/** 选区 / 文档修订号 / 文档值变化后：草稿未被本地改动时跟随文档。 */
watch(
  () => [
    selectedPath.value,
    ctx.docRevision,
    selectedStatus.value.present,
    selectedStatus.value.problem,
    selectedStatus.value.points.map((point) => `${point.x},${point.y}`).join('|'),
  ],
  () => {
    if (!draftDirty.value) {
      syncDraft()
    }
  },
  { immediate: true },
)

// ── 选区切换 ───────────────────────────────────────────────────────

/** 可见条目变化后校正选中项：选中项失效时落到第一条。 */
watch(
  () => visibleEntries.value.map((entry) => entry.key).join(','),
  () => {
    const current = selectedPath.value
    const exists = current !== null && entryByPath.value.has(current)
    if (!exists) {
      selectedPath.value = visibleEntries.value[0]?.key ?? null
    }
    localError.value = ''
    draftDirty.value = false
    syncDraft()
  },
  { immediate: true },
)

function selectCurve(path: string): void {
  if (path === selectedPath.value) {
    return
  }
  selectedPath.value = path
  localError.value = ''
  draftDirty.value = false
  syncDraft()
}

// ── 草稿解析与校验（不夹紧、不重排） ────────────────────────────────

/** 草稿解析结果：数字合法（未必满足递增/范围）时给出点数组，否则给不出。 */
interface ParsedDraft {
  points: CurvePoint[]
  problem: string | null
}

function parseDraft(draft: readonly DraftPoint[]): ParsedDraft {
  const points: CurvePoint[] = []
  for (let index = 0; index < draft.length; index += 1) {
    const xText = draft[index].x.trim()
    const yText = draft[index].y.trim()
    const x = Number(xText)
    const y = Number(yText)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { points, problem: `第 ${index + 1} 个控制点需要 [x, y] 两个有限数字` }
    }
    points.push({ x, y })
  }
  return { points, problem: curvePointsProblem(points) }
}

const draftParsed = computed<ParsedDraft>(() => parseDraft(draftPoints))

/** 可提交的控制点：草稿整体合法时才有值。 */
const numericDraft = computed<CurvePoint[] | null>(() =>
  draftParsed.value.problem === null ? draftParsed.value.points : null,
)

// ── 命令提交 ───────────────────────────────────────────────────────

/** 同一串连续编辑的合并身份（撤销一次回到该串开始之前）。 */
function coalesceKey(path: string): string {
  return `color-curve:${props.clipKey}:${path}`
}

/** 写整条曲线；草稿非法时不写文档。返回是否已真正写入。 */
function commitSetValue(path: string, points: readonly CurvePoint[]): boolean {
  const problem = curvePointsProblem(points)
  if (problem !== null) {
    localError.value = problem
    return false
  }
  const value: JsonValue = { value: curvePointsToJson(points) }
  const outcome = ctx.commands.commit(
    { kind: 'object.setValue', clipKey: props.clipKey, path, value },
    coalesceKey(path),
  )
  if (!outcome.ok) {
    localError.value = outcome.error ?? '曲线写入被拒绝'
    return false
  }
  localError.value = ''
  draftDirty.value = false
  syncDraft()
  return true
}

/** 删除整条曲线路径（清空 / 0 点）；一次撤销可恢复。 */
function commitRemove(path: string): boolean {
  const outcome = ctx.commands.commit(
    { kind: 'object.remove', clipKey: props.clipKey, path },
    coalesceKey(path),
  )
  if (!outcome.ok) {
    localError.value = outcome.error ?? '清空曲线被拒绝'
    return false
  }
  localError.value = ''
  draftDirty.value = false
  syncDraft()
  return true
}

// ── 表内操作 ──────────────────────────────────────────────────────

const canEdit = computed(() => !props.disabled)

/** 增点：在末段之间补一个点；未设置/草稿不足两点时先以身份曲线起表。 */
function addPoint(): void {
  const path = selectedPath.value
  if (!canEdit.value || path === null) {
    return
  }
  const source = numericDraft.value
  const base = source ?? (selectedStatus.value.points.length >= 2 ? selectedStatus.value.points : [])
  let next: CurvePoint[]
  if (base.length < 2) {
    next = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  } else {
    next = base.map((point) => ({ ...point }))
    const last = next[next.length - 1]
    const previous = next.length >= 2 ? next[next.length - 2] : null
    const low = previous === null ? 0 : previous.x
    const high = last.x
    const midX = low + (high - low) / 2
    next.push({ x: midX, y: last.y })
  }
  draftPoints.splice(0, draftPoints.length, ...pointsToDraft(next))
  draftDirty.value = true
  commitSetValue(path, next)
}

/** 删点；删到 0 点时按"清空曲线"删路径。 */
function removePoint(index: number): void {
  const path = selectedPath.value
  if (!canEdit.value || path === null) {
    return
  }
  const current = numericDraft.value
  if (current === null) {
    localError.value = draftParsed.value.problem ?? '当前草稿非法，无法删点'
    return
  }
  const next = current.filter((_, itemIndex) => itemIndex !== index)
  draftPoints.splice(0, draftPoints.length, ...pointsToDraft(next))
  draftDirty.value = true
  if (next.length === 0) {
    commitRemove(path)
    return
  }
  commitSetValue(path, next)
}

/** 上移 / 下移相邻点（交换位置，顺序合法性仍由提交校验）。 */
function movePoint(index: number, direction: -1 | 1): void {
  const path = selectedPath.value
  if (!canEdit.value || path === null) {
    return
  }
  const current = numericDraft.value
  if (current === null) {
    localError.value = draftParsed.value.problem ?? '当前草稿非法，无法移动点'
    return
  }
  const target = index + direction
  if (target < 0 || target >= current.length) {
    return
  }
  const next = current.map((point) => ({ ...point }))
  const swapped = next[index]
  next[index] = next[target]
  next[target] = swapped
  draftPoints.splice(0, draftPoints.length, ...pointsToDraft(next))
  draftDirty.value = true
  commitSetValue(path, next)
}

/** 单轴编辑：草稿先落地，回车 / 失焦时提交；非法值不写入。 */
function updatePointAxis(index: number, axis: 'x' | 'y', event: Event): void {
  const input = event.target as HTMLInputElement
  if (draftPoints[index] === undefined) {
    return
  }
  draftPoints[index][axis] = input.value
  draftDirty.value = true
}

function commitPointEdit(): void {
  const path = selectedPath.value
  if (!canEdit.value || path === null) {
    return
  }
  const current = numericDraft.value
  if (current === null) {
    localError.value = draftParsed.value.problem ?? '草稿非法，未写入'
    return
  }
  commitSetValue(path, current)
  ctx.commands.endCoalescing()
}

function cancelPointEdit(): void {
  draftDirty.value = false
  syncDraft()
  localError.value = ''
  ctx.commands.endCoalescing()
}

/** 清空整条曲线：删路径，一次撤销可恢复。 */
function clearCurve(): void {
  const path = selectedPath.value
  if (!canEdit.value || path === null) {
    return
  }
  commitRemove(path)
  ctx.commands.endCoalescing()
}

// ── 浮层 / 窄面板 ──────────────────────────────────────────────────

function toggleSheet(): void {
  sheetOpen.value = !sheetOpen.value
}

function closeSheet(): void {
  sheetOpen.value = false
}

function onRootKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && sheetOpen.value) {
    event.stopPropagation()
    closeSheet()
  }
}

onMounted(() => {
  const element = rootEl.value
  if (element === null) {
    return
  }
  rootWidth.value = element.clientWidth
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      rootWidth.value = element.clientWidth
    })
    resizeObserver.observe(element)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

// ── 只读曲线示意 ───────────────────────────────────────────────────

/** 示意用控制点：草稿合法用草稿，否则回退文档已解析点；都没有则画身份提示。 */
const previewPoints = computed<CurvePoint[]>(() => {
  if (numericDraft.value !== null) {
    return numericDraft.value
  }
  if (selectedStatus.value.points.length >= 2) {
    return selectedStatus.value.points
  }
  return [{ x: 0, y: 0 }, { x: 1, y: 1 }]
})

function toSvgX(x: number): number {
  return SHEET_PADDING + x * (SHEET_WIDTH - SHEET_PADDING * 2)
}

function toSvgY(y: number): number {
  return SHEET_HEIGHT - SHEET_PADDING - y * (SHEET_HEIGHT - SHEET_PADDING * 2)
}

const previewPolyline = computed<string>(() =>
  previewPoints.value
    .map((point) => `${toSvgX(point.x).toFixed(2)},${toSvgY(point.y).toFixed(2)}`)
    .join(' '),
)

/** 文档里已存在但值非法（解析失败）时，示意区与列表都要标注。 */
const storedInvalid = computed(() => selectedStatus.value.present && selectedStatus.value.problem !== null)

const curveCount = computed(() => visibleEntries.value.length)
</script>

<template>
  <div
    ref="rootEl"
    class="color-curve"
    :class="{ 'color-curve--narrow': narrow }"
    @keydown.esc="onRootKeydown"
  >
    <p v-if="curveCount === 0" class="color-curve__muted" role="status">
      本片段没有留在属性面板的调色曲线字段。
    </p>

    <template v-else>
      <div class="color-curve__body">
        <!-- 左：曲线列表（名称 + 已设置 / 未设置） -->
        <ul class="color-curve__list" role="listbox" aria-label="调色曲线列表">
          <li v-for="entry in visibleEntries" :key="entry.key">
            <button
              type="button"
              class="color-curve__item"
              :class="{ 'color-curve__item--active': entry.key === selectedPath }"
              :aria-pressed="entry.key === selectedPath"
              :disabled="!canEdit"
              @click="selectCurve(entry.key)"
            >
              <span class="color-curve__item-label">{{ labelOfEntry(entry) }}</span>
              <span
                class="color-curve__item-state"
                :class="{
                  'color-curve__item-state--set': stateOf(entry.key) === 'set',
                  'color-curve__item-state--invalid': stateOf(entry.key) === 'invalid',
                }"
              >
                {{ stateOf(entry.key) === 'set' ? '已设置' : stateOf(entry.key) === 'invalid' ? '值非法' : '未设置' }}
              </span>
            </button>
          </li>
        </ul>

        <!-- 右：当前曲线的示意与表（共用一份表，切换曲线只换数据） -->
        <div class="color-curve__panel">
          <svg
            class="color-curve__preview"
            :viewBox="`0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}`"
            role="img"
            :aria-label="`${selectedEntry !== undefined ? labelOfEntry(selectedEntry) : '曲线'}形状示意`"
          >
            <!-- 0~1 边框 -->
            <rect
              :x="SHEET_PADDING"
              :y="SHEET_PADDING"
              :width="SHEET_WIDTH - SHEET_PADDING * 2"
              :height="SHEET_HEIGHT - SHEET_PADDING * 2"
              class="color-curve__frame"
              fill="none"
            />
            <!-- 身份曲线 0→1 参考线 -->
            <line
              :x1="toSvgX(0)"
              :y1="toSvgY(0)"
              :x2="toSvgX(1)"
              :y2="toSvgY(1)"
              class="color-curve__identity"
            />
            <polyline :points="previewPolyline" class="color-curve__line" fill="none" />
            <circle
              v-for="(point, index) in previewPoints"
              :key="index"
              :cx="toSvgX(point.x)"
              :cy="toSvgY(point.y)"
              r="3"
              class="color-curve__dot"
            />
          </svg>

          <p v-if="selectedStatus.present && selectedStatus.problem !== null" class="color-curve__muted">
            已存储的值无法解析：{{ selectedStatus.problem }}
          </p>
          <p v-else-if="!selectedStatus.present" class="color-curve__muted">
            未设置（身份曲线 0→1）。添加控制点后写入；清空即删除该路径。
          </p>

          <div class="color-curve__toolbar">
            <button
              type="button"
              class="color-curve__button"
              :disabled="!canEdit"
              @click="toggleSheet"
            >
              {{ sheetOpen ? '收起控制点表' : '展开控制点表' }}
            </button>
            <button
              type="button"
              class="color-curve__button"
              :disabled="!canEdit || !selectedStatus.present"
              @click="clearCurve"
            >
              清空曲线
            </button>
          </div>

          <!-- 控制点表：窄面板浮层承载；宽度不足浮层时退化为组内联展开 -->
          <div
            v-if="sheetOpen"
            class="color-curve__sheet"
            :class="{ 'color-curve__sheet--overlay': narrow }"
            role="group"
            aria-label="控制点表"
          >
            <div class="color-curve__sheet-scroll">
              <div class="color-curve__head">
                <span class="color-curve__head-axis">x</span>
                <span class="color-curve__head-axis">y</span>
                <span class="color-curve__head-actions">操作</span>
              </div>

              <div v-for="(point, index) in draftPoints" :key="index" class="color-curve__row">
                <input
                  class="color-curve__input"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  :value="point.x"
                  :disabled="!canEdit"
                  :aria-label="`第 ${index + 1} 个控制点 x`"
                  @input="updatePointAxis(index, 'x', $event)"
                  @change="commitPointEdit"
                  @keydown.enter.prevent="commitPointEdit"
                  @keydown.esc.prevent="cancelPointEdit"
                />
                <input
                  class="color-curve__input"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  :value="point.y"
                  :disabled="!canEdit"
                  :aria-label="`第 ${index + 1} 个控制点 y`"
                  @input="updatePointAxis(index, 'y', $event)"
                  @change="commitPointEdit"
                  @keydown.enter.prevent="commitPointEdit"
                  @keydown.esc.prevent="cancelPointEdit"
                />
                <div class="color-curve__row-actions">
                  <button
                    type="button"
                    class="color-curve__button color-curve__button--small"
                    :disabled="!canEdit || index === 0"
                    :aria-label="`上移第 ${index + 1} 个控制点`"
                    @click="movePoint(index, -1)"
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    class="color-curve__button color-curve__button--small"
                    :disabled="!canEdit || index === draftPoints.length - 1"
                    :aria-label="`下移第 ${index + 1} 个控制点`"
                    @click="movePoint(index, 1)"
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    class="color-curve__button color-curve__button--small"
                    :disabled="!canEdit"
                    :aria-label="`删除第 ${index + 1} 个控制点`"
                    @click="removePoint(index)"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div class="color-curve__sheet-actions">
                <button
                  type="button"
                  class="color-curve__button"
                  :disabled="!canEdit"
                  @click="addPoint"
                >
                  添加点
                </button>
                <span class="color-curve__muted">至少 2 点；x 严格递增，两轴均在 0~1。</span>
              </div>
            </div>
          </div>

          <p v-if="localError !== ''" class="color-curve__error" role="alert">{{ localError }}</p>
          <p v-else-if="storedInvalid" class="color-curve__error" role="alert">
            文档中该曲线值非法，请修正或清空后重设。
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.color-curve {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
  color: var(--text);
}

.color-curve__body {
  display: flex;
  gap: 8px;
  min-width: 0;
}

/* 左：曲线列表 */
.color-curve__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  min-width: 104px;
  list-style: none;
}

.color-curve__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}

.color-curve__item--active {
  border-color: var(--accent);
  color: var(--text);
  background: var(--bg-raised);
}

.color-curve__item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.color-curve__item:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.color-curve__item-label {
  overflow: hidden;
  font-family: var(--font-mono, ui-monospace, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.color-curve__item-state {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 10px;
}

.color-curve__item-state--set {
  color: var(--success);
}

.color-curve__item-state--invalid {
  color: var(--error);
}

/* 右：示意与表 */
.color-curve__panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.color-curve__preview {
  width: 100%;
  max-width: 240px;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
}

.color-curve__frame {
  stroke: var(--border-strong);
  stroke-width: 1;
}

.color-curve__identity {
  stroke: var(--border-strong);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.color-curve__line {
  stroke: var(--accent);
  stroke-width: 2;
}

.color-curve__dot {
  fill: var(--bg-raised);
  stroke: var(--focus);
  stroke-width: 1.5;
}

.color-curve__toolbar,
.color-curve__sheet-actions,
.color-curve__row-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.color-curve__button {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.color-curve__button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.color-curve__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.color-curve__button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.color-curve__button--small {
  padding: 1px 4px;
}

/* 控制点表 */
.color-curve__sheet {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
}

/* 窄面板：绝对定位浮层叠在组内，自身可滚动，不夺焦点、不用 dialog。 */
.color-curve__sheet--overlay {
  position: absolute;
  z-index: 30;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 220px;
  box-shadow: 0 2px 8px var(--shadow, rgb(0 0 0 / 45%));
}

.color-curve__sheet-scroll {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  overflow-y: auto;
}

.color-curve__head,
.color-curve__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.color-curve__head {
  color: var(--text-muted);
  font-size: 10px;
}

.color-curve__head-axis,
.color-curve__input {
  width: 72px;
  flex: 0 0 72px;
}

.color-curve__head-actions,
.color-curve__row-actions {
  flex: 1 1 auto;
  min-width: 0;
}

.color-curve__input {
  padding: 1px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
}

.color-curve__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.color-curve__input:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.color-curve__muted {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.color-curve__error {
  margin: 0;
  color: var(--error);
  font-size: 10px;
}
</style>
