<script setup lang="ts">
/**
 * 时序与连续性区（11-03）：delay / repeatable / on_enter / exit_buffer / poll_interval /
 * continuity.sweep · dwell · window。适用性全部来自目录表；越界 / 非整数 / 非数字就地报错，
 * 不夹取、不静默改写。生效 poll_interval 显示来源（触发器 / 脚本 / 类型）。
 */
import { computed } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isFiniteNumber } from '../../../core/doc/json.ts'
import { parseTriggerNode } from '../../../features/behavior/trigger.ts'
import {
  continuityTickError,
  pollIntervalError,
  regionHasExpandableSpace,
  resolvePollInterval,
} from '../panels/triggerPanelModel.ts'
import type { PanelTrigger } from '../panels/triggerPanelModel.ts'

const props = defineProps<{
  draft: JsonObject
  row: PanelTrigger | null
  meta: JsonObject | null
}>()

const index = computed(() => props.row?.node.index ?? 0)
const node = computed(() => parseTriggerNode(props.draft, index.value))
const info = computed(() => node.value.info)

const poll = computed(() =>
  resolvePollInterval(node.value, props.meta?.trigger_poll_interval),
)

const continuity = computed<JsonObject>(() => {
  if (!props.draft.continuity || typeof props.draft.continuity !== 'object') {
    return {}
  }
  return props.draft.continuity as JsonObject
})

const exitBufferEditable = computed(() => {
  if (info.value === undefined || !info.value.timing.exitBuffer) return false
  if (props.draft.on_enter !== true) return false
  return regionHasExpandableSpace(node.value.conditions)
})

const onEnterEditable = computed(() => info.value?.timing.onEnter ?? false)
const pollEditable = computed(() => info.value?.timing.pollInterval ?? false)
const sweepEditable = computed(() => info.value?.timing.sweep ?? false)
const dwellEditable = computed(() => info.value?.timing.dwell ?? false)
const windowEditable = computed(() => info.value?.timing.window ?? false)

const pollError = computed(() => pollIntervalError(props.draft.poll_interval))
const dwellError = computed(() => continuityTickError(continuity.value.dwell, 'continuity.dwell'))
const windowError = computed(() => continuityTickError(continuity.value.window, 'continuity.window'))
const exitBufferError = computed(() => {
  const value = props.draft.exit_buffer
  if (value === undefined || value === null) return null
  if (!isFiniteNumber(value)) return 'exit_buffer 需要数字（格）'
  return null
})

function ensureContinuity(): JsonObject {
  if (!props.draft.continuity || typeof props.draft.continuity !== 'object') {
    props.draft.continuity = {}
  }
  return props.draft.continuity as JsonObject
}

function onNumberInput(key: 'delay' | 'exit_buffer', event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.value === '') {
    delete props.draft[key]
    return
  }
  props.draft[key] = Number(target.value)
}

function onPollInput(event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.value === '') {
    delete props.draft.poll_interval
    return
  }
  props.draft.poll_interval = Number(target.value)
}

function onRepeatableChange(event: Event): void {
  props.draft.repeatable = (event.target as HTMLInputElement).checked
}

function onOnEnterChange(event: Event): void {
  props.draft.on_enter = (event.target as HTMLInputElement).checked
}

function onSweepChange(event: Event): void {
  const cont = ensureContinuity()
  cont.sweep = (event.target as HTMLInputElement).checked
}

function onDwellInput(event: Event): void {
  const cont = ensureContinuity()
  const target = event.target as HTMLInputElement
  if (target.value === '') {
    delete cont.dwell
    return
  }
  cont.dwell = Number(target.value)
}

function onWindowInput(event: Event): void {
  const cont = ensureContinuity()
  const target = event.target as HTMLInputElement
  if (target.value === '') {
    delete cont.window
    return
  }
  cont.window = Number(target.value)
}

</script>

<template>
  <section class="timing" aria-label="触发时序与连续性">
    <h3 class="section-title">触发时序</h3>

    <div class="timing__field">
      <span class="timing__label">延迟（秒，0 = 立即）</span>
      <input
        class="timing__input"
        type="number"
        step="0.1"
        :value="draft.delay ?? ''"
        @input="onNumberInput('delay', $event)"
      />
    </div>

    <label class="timing__field timing__row">
      <input type="checkbox" :checked="draft.repeatable === true" @change="onRepeatableChange" />
      <span>可重复触发</span>
    </label>

    <div v-if="onEnterEditable" class="timing__field">
      <span class="timing__label">on_enter（仅进入边沿）</span>
      <label class="timing__row">
        <input type="checkbox" :checked="draft.on_enter === true" @change="onOnEnterChange" />
        <span>只在条件 false → true 的边沿触发</span>
      </label>
    </div>
    <p v-else-if="draft.on_enter !== undefined" class="timing__legacy">
      on_enter 当前不适用，旧值 {{ String(draft.on_enter) }} 会保留到清理
    </p>

    <div v-if="exitBufferEditable" class="timing__field">
      <span class="timing__label">exit_buffer（格，区域外扩）</span>
      <input
        class="timing__input"
        type="number"
        step="0.1"
        :value="draft.exit_buffer ?? ''"
        @input="onNumberInput('exit_buffer', $event)"
      />
      <span v-if="exitBufferError" class="timing__error" role="alert">{{ exitBufferError }}</span>
    </div>
    <p v-else-if="isFiniteNumber(draft.exit_buffer)" class="timing__legacy">
      exit_buffer 当前不适用，旧值 {{ draft.exit_buffer }} 会保留到清理
    </p>

    <div v-if="pollEditable" class="timing__field">
      <span class="timing__label">poll_interval（tick，1~600）</span>
      <input
        class="timing__input"
        type="number"
        :value="draft.poll_interval ?? ''"
        :placeholder="poll.value === null ? '' : String(poll.value)"
        @input="onPollInput"
      />
      <span v-if="pollError" class="timing__error" role="alert">{{ pollError }}</span>
    </div>
    <p v-else-if="draft.poll_interval !== undefined" class="timing__legacy">
      poll_interval 当前不适用，旧值 {{ String(draft.poll_interval) }} 会保留到清理
    </p>

    <h4 v-if="sweepEditable || dwellEditable || windowEditable" class="timing__subtitle">连续性</h4>

    <div v-if="sweepEditable" class="timing__field">
      <span class="timing__label">sweep（段扫掠）</span>
      <label class="timing__row">
        <input type="checkbox" :checked="continuity.sweep === true" @change="onSweepChange" />
        <span>沿几何路径扫掠判定</span>
      </label>
    </div>

    <div v-if="dwellEditable" class="timing__field">
      <span class="timing__label">dwell（停留门槛，tick）</span>
      <input
        class="timing__input"
        type="number"
        :value="continuity.dwell ?? ''"
        @input="onDwellInput"
      />
      <span v-if="dwellError" class="timing__error" role="alert">{{ dwellError }}</span>
    </div>

    <div v-if="windowEditable" class="timing__field">
      <span class="timing__label">window（事件子项窗口，tick）</span>
      <input
        class="timing__input"
        type="number"
        :value="continuity.window ?? ''"
        @input="onWindowInput"
      />
      <span v-if="windowError" class="timing__error" role="alert">{{ windowError }}</span>
    </div>
  </section>
</template>

<style scoped>
.timing {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
}

.section-title,
.timing__subtitle {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.timing__subtitle {
  font-size: 11px;
  color: var(--text-muted, #999);
}

.timing__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.timing__row {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.timing__label {
  font-size: 11px;
  color: var(--text-muted, #999);
}

.timing__input {
  font: inherit;
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--panel-bg, #1c1c1c);
  color: var(--text, #eee);
}

.timing__legacy {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted, #999);
}

.timing__error {
  font-size: 11px;
  color: var(--error, #e05555);
}

</style>
