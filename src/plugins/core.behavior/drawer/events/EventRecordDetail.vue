<script setup lang="ts">
/**
 * 行为抽屉 · 事件记录唯一详情编辑器（11-12 EVENT / 11-13 MOD_EVENT）。
 *
 * 本组件是行为页事件记录的唯一字段面：时间、命令 / 事件名、位置 / 数据、记录 id。
 * 字段表与命令翻译全部复用 `features/effects/eventRecords.ts`，不另造第二套字段表；
 * 校验问题来自 `features/behavior/events.ts` 的读取模型（`node.problems`），本组件不重复判形状。
 *
 * 边界（11-12 §4.4 / 11-13 §4.4）：
 * - 不判断某条记录在玩家身上是否已触发，不显示生效 / 未生效；
 * - MOD_EVENT 内置播放器不消费，只保证格式与落盘；
 * - 位置两套写法互斥，不足两个航点不驱动移动；相对基准是脚本激活位置（触发点）。
 */
import { computed, ref, watch } from 'vue'
import type { DocCommand } from '../../../../core/doc/commands.ts'
import { isJsonObject } from '../../../../core/doc/json.ts'
import type { JsonObject, JsonValue } from '../../../../core/doc/types.ts'
import { EVENT_COMMAND_TYPE, MOD_EVENT_FORBIDDEN_KEYS, recordAllowedKeys } from '../../../../core/schema/catalog/behaviorEvents.ts'
import type { CatalogIndex } from '../../../../core/schema/index.ts'
import {
  RECORD_COPY_OFFSET,
  duplicateRecordCommand,
  formatRecordBody,
  moveRecordCommand,
  readRecordBody,
  removeRecordCommand,
  setRecordFieldCommand,
  unknownFields,
} from '../../../../features/effects/eventRecords.ts'
import type { PropertyRow } from '../../../../features/effects/types.ts'
import { buildPropertyRows } from '../../../../features/effects/rows.ts'
import type { ClipEventContext, EventRecordNode } from '../../../../features/behavior/events.ts'
import { foldSeverity } from '../../../../features/behavior/validation.ts'
import { CATALOG_SERVICE } from '../../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../../workbench/host/panelContext.ts'
import {
  buildObjectDefaultValue,
  buildSetObjectDefaultCommand,
  readObjectDefaults,
  validateDefaultDataTree,
  type ObjectDefaultPatch,
} from './objectDefaults.ts'
import DataObjectEditor from './DataObjectEditor.vue'

const props = defineProps<{
  node: EventRecordNode
  /** 该片段 `objects` 的只读克隆；没有为 `null`。 */
  objects: JsonObject | null
  clipCtx: ClipEventContext
  /** 同一事件对象内的记录总数（唯一记录不能删）。 */
  siblingCount: number
}>()

const ctx = usePanelContext()
const catalog: CatalogIndex | undefined = ctx.services.get(CATALOG_SERVICE)

const row = computed<PropertyRow | null>(() => {
  if (props.objects === null || catalog === undefined) {
    return null
  }
  const rows = buildPropertyRows({
    clipKey: props.node.clipKey,
    clip: { objects: props.objects },
    trackType: props.node.trackType,
    catalog,
  })
  return rows.find((item) => item.path === props.node.objectPath) ?? null
})

const body = computed<JsonObject | null>(() => {
  if (row.value !== null) {
    return readRecordBody(row.value, props.node.time)
  }
  return props.node.body
})

/** 对象级缺省（`objects.<path>.value`）；MOD_EVENT 可编辑，写入不回填已覆盖记录。 */
const fallbackSnapshot = computed(() => readObjectDefaults(props.objects, props.node.objectPath))

const fallback = computed<JsonObject | null>(() => fallbackSnapshot.value.raw)

const fallbackEventType = computed(() => fallbackSnapshot.value.eventType)
const fallbackData = computed(() => fallbackSnapshot.value.data)

const isLast = computed(() => props.siblingCount <= 1)

// ── 草稿 ────────────────────────────────────────────────────────────────

const error = ref('')
const notice = ref('')

const drafts = ref<Record<string, string>>({})
const positionMode = ref<'none' | 'absolute' | 'relative'>('none')
const positionDraft = ref({ a: '', b: '' })
const timeDraft = ref(String(props.node.time))
const fallbackEventDraft = ref('')

const bodySignature = computed(() => `${props.node.time}|${JSON.stringify(body.value)}`)

/** 本轨允许的记录体键白名单（来自主模组 codec 口径）。 */
const allowedKeys = computed<string[]>(() => [...recordAllowedKeys(props.node.trackType)])

/** MOD_EVENT 中被禁止出现的 EVENT 键。 */
const forbiddenKeys = computed<string[]>(() =>
  props.node.trackType === 'MOD_EVENT' ? [...MOD_EVENT_FORBIDDEN_KEYS] : [],
)

function resetDrafts(): void {
  const current = body.value
  const next: Record<string, string> = {}
  if (current !== null) {
    for (const key of allowedKeys.value) {
      const value = current[key]
      if (key === 'data') {
        next[key] = value === undefined ? '' : formatRecordBody(value)
      } else {
        next[key] = typeof value === 'string' ? value : ''
      }
    }
  }
  drafts.value = next

  const position = current?.position
  if (position !== undefined && typeof position === 'object' && position !== null && !Array.isArray(position)) {
    const record = position as Record<string, JsonValue>
    positionMode.value = Object.prototype.hasOwnProperty.call(record, 'dx') ? 'relative' : 'absolute'
    const firstKey = Object.prototype.hasOwnProperty.call(record, 'dx') ? 'dx' : 'x'
    const secondKey = firstKey === 'dx' ? 'dz' : 'z'
    const first = record[firstKey]
    const second = record[secondKey]
    positionDraft.value = {
      a: typeof first === 'number' ? String(first) : '',
      b: typeof second === 'number' ? String(second) : '',
    }
  } else {
    positionMode.value = 'none'
    positionDraft.value = { a: '', b: '' }
  }

  fallbackEventDraft.value = fallbackSnapshot.value.eventType ?? ''
}

watch(bodySignature, resetDrafts, { immediate: true })

watch(
  () => props.node.time,
  (next) => {
    timeDraft.value = String(next)
  },
)

// ── 提交 ───────────────────────────────────────────────────────────────

const coalesceKey = (field: string): string =>
  `behaviorEvent:${props.node.clipKey}:${props.node.objectPath}:${props.node.time}:${field}`

function submit(command: DocCommand, coalesce?: string): boolean {
  const outcome = ctx.commands.commit(command, coalesce)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return false
  }
  error.value = ''
  notice.value = outcome.warnings.length > 0 ? outcome.warnings.join('；') : ''
  return true
}

function commitEdits(edits: Parameters<typeof setRecordFieldCommand>[0]['edits'], field: string): void {
  const current = row.value
  const currentBody = body.value
  if (current === null || currentBody === null) {
    error.value = '记录已不存在（可能已被删除或撤销）'
    return
  }
  const result = setRecordFieldCommand({
    clipKey: props.node.clipKey,
    row: current,
    time: props.node.time,
    current: currentBody,
    edits,
  })
  if (!result.ok) {
    error.value = result.message
    return
  }
  submit(result.command, coalesceKey(field))
}

function commitText(key: string): void {
  const draft = drafts.value[key] ?? ''
  const currentValue = body.value?.[key]
  if (typeof currentValue === 'string' && currentValue === draft) {
    ctx.commands.endCoalescing()
    return
  }
  if (currentValue === undefined && draft === '') {
    ctx.commands.endCoalescing()
    return
  }
  commitEdits([{ key, value: draft }], key)
}

function commitPosition(): void {
  if (positionMode.value === 'none') {
    commitEdits([{ key: 'position', remove: true }], 'position')
    return
  }
  const first = Number(positionDraft.value.a.trim())
  const second = Number(positionDraft.value.b.trim())
  if (positionDraft.value.a.trim() === '' || positionDraft.value.b.trim() === '') {
    error.value = 'position 需要两个数字分量'
    return
  }
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    error.value = 'position 的分量必须是有限数字'
    return
  }
  const value: JsonObject = positionMode.value === 'absolute'
    ? { x: first, z: second }
    : { dx: first, dz: second }
  commitEdits([{ key: 'position', value }], 'position')
}

function switchPositionMode(mode: 'none' | 'absolute' | 'relative'): void {
  if (positionMode.value === mode) {
    return
  }
  positionMode.value = mode
  if (mode === 'none') {
    commitPosition()
  }
}

function commitTime(): void {
  const current = row.value
  if (current === null) {
    error.value = '记录已不存在'
    return
  }
  const target = Number(timeDraft.value.trim())
  if (!Number.isFinite(target)) {
    error.value = '记录时间必须是有限数字'
    return
  }
  if (Math.abs(target - props.node.time) <= 1e-6) {
    error.value = ''
    return
  }
  const result = moveRecordCommand({
    clipKey: props.node.clipKey,
    row: current,
    from: props.node.time,
    to: target,
  })
  if (!result.ok) {
    error.value = result.message
    timeDraft.value = String(props.node.time)
    return
  }
  if (submit(result.command)) {
    timeDraft.value = String(target)
  } else {
    timeDraft.value = String(props.node.time)
  }
}

function deleteRecord(): void {
  const current = row.value
  if (current === null) {
    error.value = '记录已不存在'
    return
  }
  const result = removeRecordCommand({
    clipKey: props.node.clipKey,
    row: current,
    time: props.node.time,
  })
  if (!result.ok) {
    error.value = result.message
    return
  }
  submit(result.command)
}

function duplicateRecord(): void {
  const current = row.value
  const currentBody = body.value
  if (current === null || currentBody === null) {
    error.value = '记录已不存在'
    return
  }
  const result = duplicateRecordCommand({
    clipKey: props.node.clipKey,
    row: current,
    from: props.node.time,
    body: currentBody,
  })
  if (!result.ok) {
    error.value = result.message
    return
  }
  const command = result.command
  if (command.kind !== 'object.addKeyframe') {
    error.value = '复制命令形态异常（内部错误）'
    return
  }
  if (submit(command)) {
    notice.value = `已复制到 t=${command.time}（相对偏移 ${RECORD_COPY_OFFSET}s）`
  }
}

function onFieldBlur(): void {
  ctx.commands.endCoalescing()
}

// ── 对象级缺省写入（仅 MOD_EVENT 可编辑；不回填已覆盖记录）──────────────

const fallbackCoalesceKey = (field: string): string =>
  `behaviorEventDefault:${props.node.clipKey}:${props.node.objectPath}:${field}`

function commitFallbackEventType(): void {
  if (!isModEvent.value) {
    return
  }
  const draft = fallbackEventDraft.value.trim()
  const current = fallbackSnapshot.value.eventType
  if ((current ?? '') === draft) {
    ctx.commands.endCoalescing()
    return
  }
  const patch: ObjectDefaultPatch = draft === '' ? { eventType: null } : { eventType: draft }
  const value = buildObjectDefaultValue(fallbackSnapshot.value.raw, patch)
  const command = buildSetObjectDefaultCommand({
    clipKey: props.node.clipKey,
    path: props.node.objectPath,
    value,
  })
  if (submit(command, fallbackCoalesceKey('event_type'))) {
    fallbackEventDraft.value = draft
  } else {
    fallbackEventDraft.value = current ?? ''
  }
}

function applyFallbackData(next: JsonObject | null): void {
  if (!isModEvent.value) {
    return
  }
  const current = fallbackSnapshot.value.data
  if (next === null) {
    if (current === null) {
      ctx.commands.endCoalescing()
      return
    }
  } else {
    const treeFailure = validateDefaultDataTree(next, 'data')
    if (treeFailure !== null) {
      error.value = treeFailure
      return
    }
  }
  const value = buildObjectDefaultValue(fallbackSnapshot.value.raw, { data: next })
  const command = buildSetObjectDefaultCommand({
    clipKey: props.node.clipKey,
    path: props.node.objectPath,
    value,
  })
  submit(command, fallbackCoalesceKey('data'))
}

function clearFallbackData(): void {
  applyFallbackData(null)
}

/** 记录级 data 结构化编辑提交：走既有记录体命令翻译，不另拼命令字面量。 */
function applyRecordData(next: JsonObject): void {
  const treeFailure = validateDefaultDataTree(next, 'data')
  if (treeFailure !== null) {
    error.value = treeFailure
    return
  }
  commitEdits([{ key: 'data', value: next }], 'data')
}

// ── 派生展示 ───────────────────────────────────────────────────────────

const unknownKeys = computed(() => unknownFields(body.value, allowedKeys.value))

function isForbiddenKey(key: string): boolean {
  return forbiddenKeys.value.includes(key)
}
const rawBody = computed(() => formatRecordBody(body.value))

const globalTime = computed(() =>
  Number.isFinite(props.node.time) ? props.clipCtx.clipStartTime + props.node.time : NaN,
)

const isModEvent = computed(() => props.node.trackType === 'MOD_EVENT')

const modEventTypeState = computed(() => {
  const recordValue = body.value?.event_type
  if (typeof recordValue === 'string' && recordValue.length > 0) {
    return { kind: 'explicit' as const, value: recordValue }
  }
  if (fallbackEventType.value !== null) {
    return { kind: 'inherited' as const, value: fallbackEventType.value }
  }
  return { kind: 'missing' as const, value: null }
})

const dataState = computed<'explicit-object' | 'explicit-empty' | 'inherited' | 'absent'>(() => {
  if (!props.node.hasData) {
    return fallbackData.value !== null ? 'inherited' : 'absent'
  }
  return body.value?.data !== undefined && isJsonObject(body.value.data) && Object.keys(body.value.data).length === 0
    ? 'explicit-empty'
    : 'explicit-object'
})

/** 记录级 data 顶层对象（可结构化编辑）；非对象时不提供键值视图。 */
const recordDataObject = computed<JsonObject | null>(() => {
  const data = body.value?.data
  return isJsonObject(data) ? data : null
})

const recordDataInvalid = computed(
  () => body.value !== null && body.value.data !== undefined && !isJsonObject(body.value.data),
)

const problemRows = computed(() =>
  props.node.problems.map((problem) => ({
    problem,
    folded: foldSeverity(problem.severity),
  })),
)

/** 记录级字段来源标注：值来自记录自身，还是继承对象级缺省。 */
const eventTypeSourceLabel = computed(() => {
  if (modEventTypeState.value.kind === 'explicit') return '记录级写入'
  if (modEventTypeState.value.kind === 'inherited') return '继承对象级'
  return '两边未写'
})

const dataSourceLabel = computed(() => {
  if (dataState.value === 'explicit-object' || dataState.value === 'explicit-empty') return '记录级写入'
  if (dataState.value === 'inherited') return '继承对象级'
  return '两边未写'
})

function severityLabel(severity: 'error' | 'warn' | 'info'): string {
  return severity === 'error' ? '错误' : severity === 'warn' ? '警告' : '信息'
}
</script>

<template>
  <section class="event-detail" aria-label="事件记录编辑器">
    <header class="event-detail__header">
      <div class="event-detail__title">
        <span class="event-detail__path">{{ node.objectPath }}</span>
        <span class="event-detail__kind">{{ node.trackType }}</span>
      </div>
      <span class="event-detail__count">{{ siblingCount }} 条记录</span>
    </header>

    <p v-if="node.body === null" class="event-detail__empty" role="alert">
      记录 t={{ node.time }} 不是对象；结构问题见下方诊断。
    </p>

    <!-- 对象级缺省：MOD_EVENT 可编辑；EVENT 只读。写入不回填已覆盖记录。 -->
    <div class="event-detail__fallback" :class="{ 'event-detail__fallback--empty': fallback === null && !isModEvent }">
      <p class="event-detail__fallback-title">
        对象级缺省<template v-if="isModEvent">（可编辑）</template>
        <template v-else>（只读）</template>
      </p>

      <template v-if="isModEvent">
        <label class="event-detail__label" for="fallback-event-type">event_type（对象级回退）</label>
        <input
          id="fallback-event-type"
          class="event-detail__input"
          v-model="fallbackEventDraft"
          placeholder="省略 = 无事件名回退；记录未写 event_type 时继承此值"
          @blur="commitFallbackEventType()"
        />
        <label class="event-detail__label" for="fallback-data">data（对象级回退，JSON 对象）</label>
        <DataObjectEditor
          :value="fallbackData ?? {}"
          :depth="1"
          @apply="applyFallbackData"
        />
        <button
          v-if="fallbackData !== null"
          type="button"
          class="event-detail__link-button"
          @click="clearFallbackData"
        >
          移除对象级 data 缺省（回到省略）
        </button>
        <p class="event-detail__hint">
          对象级缺省只影响未覆盖（未显式写该字段）的记录；已写记录保持不变，不会被回填。
        </p>
      </template>

      <template v-else>
        <template v-if="fallback !== null">
          <p class="event-detail__fallback-row">
            event_type：<code>{{ fallbackEventType ?? '未写' }}</code>
          </p>
        </template>
        <p v-else class="event-detail__fallback-row">该对象没有显式对象级缺省。</p>
        <p class="event-detail__hint">记录未写该字段时回退到这里；修改对象级缺省不会回填已经写字段的记录。</p>
      </template>
    </div>

    <p v-if="isModEvent" class="event-detail__banner" role="status">
      MOD_EVENT 是给模组消费者的扩展通道：内置播放器不消费该轨，这里只保证格式与落盘，不显示生效 / 未生效。
    </p>

    <!-- 时间 -->
    <div class="event-detail__row">
      <label class="event-detail__label" for="event-record-time">时间（片段局部秒）</label>
      <input
        id="event-record-time"
        v-model="timeDraft"
        class="event-detail__input event-detail__input--number"
        type="number"
        step="0.001"
        min="0"
        @blur="commitTime(); onFieldBlur()"
        @keydown.enter.prevent="commitTime(); onFieldBlur()"
      />
      <span class="event-detail__hint">
        全局 {{ Number.isFinite(globalTime) ? `${globalTime.toFixed(3)}s` : '未知' }}；时间非负有限、同对象内严格递增。
      </span>
    </div>

    <template v-if="body !== null">
      <!-- EVENT 字段 -->
      <template v-if="!isModEvent">
        <div class="event-detail__field">
          <label class="event-detail__label" for="event-record-command">command</label>
          <textarea
            id="event-record-command"
            v-model="drafts.command"
            class="event-detail__textarea"
            rows="3"
            spellcheck="false"
            placeholder="空串 = 占位：已触发但不执行"
            @blur="commitText('command'); onFieldBlur()"
          ></textarea>
          <p class="event-detail__hint">
            多条命令用 <code>&&</code> 分隔，原样保留不拆段；前导斜杠仅警告并保留原文。
          </p>
        </div>

        <div class="event-detail__field">
          <span class="event-detail__label">event_type</span>
          <p class="event-detail__readonly">
            当前唯一合法值 <code>{{ EVENT_COMMAND_TYPE }}</code>
            <template v-if="typeof body.event_type === 'string'">
              ；记录级写为 <code>{{ body.event_type }}</code>
            </template>
          </p>
          <p class="event-detail__hint">EVENT 不是扩展点；写其他值会被校验器拒绝。</p>
        </div>

        <div class="event-detail__field">
          <span class="event-detail__label">position</span>
          <div class="event-detail__position">
            <select
              class="event-detail__select"
              :value="positionMode"
              @change="switchPositionMode(($event.target as HTMLSelectElement).value as 'none' | 'absolute' | 'relative')"
            >
              <option value="none">未设置</option>
              <option value="absolute">{x, z} 绝对（世界坐标）</option>
              <option value="relative">{dx, dz} 相对脚本激活位置</option>
            </select>
            <template v-if="positionMode !== 'none'">
              <input
                v-model="positionDraft.a"
                class="event-detail__input event-detail__input--number"
                type="number"
                step="any"
                :aria-label="positionMode === 'absolute' ? 'x' : 'dx'"
                @blur="commitPosition(); onFieldBlur()"
                @keydown.enter.prevent="commitPosition(); onFieldBlur()"
              />
              <input
                v-model="positionDraft.b"
                class="event-detail__input event-detail__input--number"
                type="number"
                step="any"
                :aria-label="positionMode === 'absolute' ? 'z' : 'dz'"
                @blur="commitPosition(); onFieldBlur()"
                @keydown.enter.prevent="commitPosition(); onFieldBlur()"
              />
            </template>
          </div>
          <p class="event-detail__hint">
            恰好两个键，两套互斥；只有水平两轴。带位置的记录不足两条时不驱动移动；
            相对坐标的基准是脚本激活位置（触发点），不是片段起点。
          </p>
        </div>

        <div class="event-detail__field">
          <label class="event-detail__label" for="event-record-id">id（可选高级字段）</label>
          <input
            id="event-record-id"
            v-model="drafts.id"
            class="event-detail__input"
            type="text"
            @blur="commitText('id'); onFieldBlur()"
            @keydown.enter.prevent="commitText('id'); onFieldBlur()"
          />
          <p class="event-detail__hint">运行时忽略，不参与身份与去重；保留原值，不自动生成。</p>
        </div>
      </template>

      <!-- MOD_EVENT 字段 -->
      <template v-else>
        <div class="event-detail__field">
          <label class="event-detail__label" for="event-record-event-type">
            event_type
            <span class="event-detail__source-badge" :class="`event-detail__source-badge--${modEventTypeState.kind}`">{{ eventTypeSourceLabel }}</span>
          </label>
          <input
            id="event-record-event-type"
            v-model="drafts.event_type"
            class="event-detail__input"
            type="text"
            :placeholder="modEventTypeState.kind === 'inherited' ? `继承对象级：${modEventTypeState.value ?? ''}` : '自由事件名'"
            @blur="commitText('event_type'); onFieldBlur()"
            @keydown.enter.prevent="commitText('event_type'); onFieldBlur()"
          />
          <p v-if="modEventTypeState.kind === 'inherited'" class="event-detail__hint">
            记录级省略，继承对象级缺省 <code>{{ modEventTypeState.value }}</code>。
          </p>
          <p v-else-if="modEventTypeState.kind === 'missing'" class="event-detail__hint event-detail__hint--warn">
            记录级与对象级都没有事件名（缺少事件名）；空串非法，不会落回默认值。
          </p>
          <p class="event-detail__hint">自由字符串，无固定枚举；不要写斜杠命令语法。</p>
        </div>

        <div class="event-detail__field">
          <label class="event-detail__label" for="event-record-data">
            data
            <span class="event-detail__source-badge" :class="`event-detail__source-badge--${dataState}`">{{ dataSourceLabel }}</span>
          </label>
          <template v-if="recordDataInvalid">
            <p class="event-detail__hint event-detail__hint--warn">
              顶层必须是 JSON 对象；当前不是对象，结构化键值视图不可用，原始内容只读展开。
            </p>
            <pre class="event-detail__readonly-pre">{{ formatRecordBody(body?.data) }}</pre>
          </template>
          <DataObjectEditor
            v-else
            :value="recordDataObject ?? {}"
            :depth="1"
            @apply="applyRecordData"
          />
          <p v-if="dataState === 'inherited'" class="event-detail__hint">
            记录级省略 data，继承对象级缺省数据；在此新增 / 编辑键将写为记录级显式数据。
          </p>
          <p v-else-if="dataState === 'explicit-empty'" class="event-detail__hint">
            显式空对象 <code>{}</code>：不继承对象级数据。
          </p>
          <p v-else-if="dataState === 'absent'" class="event-detail__hint">
            记录级与对象级都没有 data；省略 ≠ 空对象。
          </p>
          <p class="event-detail__hint">顶层必须是 JSON 对象；内部任意嵌套，数字必须有限。</p>
        </div>
      </template>
    </template>

    <!-- 诊断 -->
    <ul v-if="problemRows.length > 0" class="event-detail__problems">
      <li
        v-for="entry in problemRows"
        :key="`${entry.problem.code}:${entry.problem.jsonPath}`"
        class="event-detail__problem"
        :class="`event-detail__problem--${entry.folded}`"
      >
        <span class="event-detail__problem-sev">{{ severityLabel(entry.folded) }}</span>
        <span class="event-detail__problem-code">{{ entry.problem.code }}</span>
        <span class="event-detail__problem-message">{{ entry.problem.message }}</span>
        <code class="event-detail__problem-path">{{ entry.problem.jsonPath }}</code>
      </li>
    </ul>

    <p v-if="error !== ''" class="event-detail__error" role="alert">{{ error }}</p>
    <p v-else-if="notice !== ''" class="event-detail__notice" role="status">{{ notice }}</p>

    <!-- 操作 -->
    <div class="event-detail__actions">
      <button type="button" class="event-detail__button" :disabled="body === null" @click="duplicateRecord">
        复制记录（+{{ RECORD_COPY_OFFSET }}s）
      </button>
      <button
        type="button"
        class="event-detail__button event-detail__button--danger"
        :disabled="isLast || body === null"
        :title="isLast ? '片段内唯一记录不能删除' : ''"
        @click="deleteRecord"
      >
        删除记录
      </button>
      <span v-if="isLast" class="event-detail__hint event-detail__hint--warn">
        唯一记录不能删：事件对象必须保留记录；要让片段不再有该通道，请删除整个事件对象。
      </span>
    </div>

    <!-- 未知键 / 原始记录（只读） -->
    <details v-if="unknownKeys.length > 0" class="event-detail__raw" open>
      <summary>未登记字段（只读，共 {{ unknownKeys.length }} 个）</summary>
      <ul class="event-detail__raw-keys">
        <li v-for="key in unknownKeys" :key="key">
          {{ key }}
          <span v-if="isForbiddenKey(key)" class="event-detail__raw-forbidden">
            禁止：EVENT 键不能出现在 MOD_EVENT
          </span>
        </li>
      </ul>
      <pre class="event-detail__raw-body">{{ rawBody }}</pre>
    </details>
    <details v-else class="event-detail__raw">
      <summary>原始记录（只读）</summary>
      <pre class="event-detail__raw-body">{{ rawBody }}</pre>
    </details>
  </section>
</template>

<style scoped>
.event-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
}

.event-detail__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.event-detail__title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.event-detail__path {
  font-family: var(--font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-detail__kind {
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.event-detail__count {
  margin-left: auto;
  color: var(--text-secondary);
  white-space: nowrap;
}

.event-detail__fallback {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
}

.event-detail__fallback--empty {
  color: var(--text-muted);
}

.event-detail__fallback-title {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.event-detail__fallback-row {
  margin: 0;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  word-break: break-word;
}

.event-detail__source-badge {
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 400;
}

.event-detail__source-badge--inherited,
.event-detail__source-badge--explicit-object,
.event-detail__source-badge--explicit-empty {
  color: var(--text-secondary);
}

.event-detail__source-badge--missing,
.event-detail__source-badge--absent {
  color: var(--text-muted);
  border-style: dashed;
}

.event-detail__banner {
  margin: 0;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
}

.event-detail__row {
  display: grid;
  grid-template-columns: 140px minmax(80px, 150px) 1fr;
  gap: 6px;
  align-items: center;
}

.event-detail__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.event-detail__label {
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.event-detail__readonly {
  margin: 0;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}

.event-detail__input,
.event-detail__select,
.event-detail__textarea {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}

.event-detail__textarea {
  resize: vertical;
  min-height: 56px;
}

.event-detail__position {
  display: flex;
  gap: 6px;
  align-items: center;
}

.event-detail__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.event-detail__hint--warn {
  color: var(--warning);
}

.event-detail__problems {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.event-detail__problem {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-left: 2px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
}

.event-detail__problem--error {
  border-left-color: var(--error);
}

.event-detail__problem--warn {
  border-left-color: var(--warning);
}

.event-detail__problem--info {
  border-left-color: var(--success);
}

.event-detail__problem-sev {
  font-weight: 600;
}

.event-detail__problem-code {
  font-family: var(--font-mono, monospace);
  color: var(--text-muted);
}

.event-detail__problem-path {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-muted);
  word-break: break-all;
}

.event-detail__error {
  margin: 0;
  padding: 4px 6px;
  border: 1px solid var(--error);
  border-radius: 3px;
  background: var(--error-bg);
  color: var(--error);
}

.event-detail__notice {
  margin: 0;
  color: var(--text-secondary);
}

.event-detail__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.event-detail__button {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.event-detail__button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.event-detail__button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.event-detail__button--danger {
  border-color: var(--error);
  color: var(--error);
}

.event-detail__empty {
  margin: 0;
  padding: 6px 8px;
  border: 1px dashed var(--border-strong);
  border-radius: 3px;
  color: var(--text-secondary);
}

.event-detail__raw {
  border-top: 1px solid var(--border);
  padding-top: 6px;
}

.event-detail__raw summary {
  color: var(--text-secondary);
  cursor: pointer;
}

.event-detail__raw-keys {
  margin: 4px 0;
  padding-left: 18px;
  color: var(--warning);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.event-detail__raw-forbidden {
  margin-left: 6px;
  color: var(--error);
  font-size: 10px;
}

.event-detail__raw-body {
  margin: 4px 0 0;
  padding: 6px;
  max-height: 200px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  white-space: pre-wrap;
}

.event-detail__readonly-pre {
  margin: 4px 0 0;
  padding: 6px;
  max-height: 160px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  white-space: pre-wrap;
}

.event-detail__link-button {
  align-self: flex-start;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}
</style>
