<script setup lang="ts">
/**
 * 规则绑定详情（11-09 / 11-10）。
 *
 * 分区：身份 → 时间门 → 控制 → 调度 → 出口 → 运行摘要 → 诊断。
 * 调度五形态 / 出口五形态的参数表来自目录；越界只报错不夹取；出口归属四条说明常显。
 */
import { computed } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { isJsonObject, isFiniteNumber } from '../../../core/doc/json.ts'
import type { ClipListEntry } from '../../../workbench/api/documents.ts'
import {
  SCHEDULE_KINDS,
  SCHEDULE_KIND_INFO,
  EXIT_KINDS,
  EXIT_KIND_INFO,
  CONTROL_KINDS,
  CONTROL_KIND_INFO,
  RULE_FACT_NAMES,
} from '../../../core/schema/catalog/behaviorRules.ts'
import type { BehaviorRefs } from '../../../core/schema/catalog/behaviorRules.ts'
import { validateBinding, describeBinding, type BindingReference } from '../../../features/behavior/bindings.ts'
import type { RecordDraft } from './draftStore.ts'
import type { BehaviorModel, BindingRow } from './drawerModel.ts'
import { asObject, writeField, parseNumberInput, numberText, unknownKeys } from './shared/fields.ts'
import FieldInput from './shared/FieldInput.vue'
import ProblemList from './shared/ProblemList.vue'

const props = defineProps<{
  row: BindingRow | null
  draft: RecordDraft | null
  refs: BehaviorRefs
  model: BehaviorModel
  clips: readonly ClipListEntry[]
  referrers: readonly BindingReference[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  apply: []
  discard: []
  remove: []
  locateRule: [ruleId: string]
}>()

// ── 草稿体 ──────────────────────────────────────────────────────────────────────

const body = computed<JsonObject | null>(() => props.draft?.body ?? null)

const gate = computed<JsonObject>(() => asObject(body.value?.gate) ?? {})
const schedule = computed<JsonObject>(() => asObject(body.value?.schedule) ?? {})
const exit = computed<JsonObject>(() => asObject(body.value?.exit) ?? {})

const clipId = computed(() => (typeof body.value?.clip === 'string' ? body.value.clip : ''))
const ruleId = computed(() => (typeof body.value?.rule === 'string' ? body.value.rule : ''))

const clipDuration = computed<number | undefined>(() =>
  clipId.value.length > 0 ? props.refs.clipDurations.get(clipId.value) : undefined,
)
const clipInfinite = computed(() => clipDuration.value !== undefined && clipDuration.value < 0)
const missingClip = computed(() => clipId.value.length > 0 && !props.refs.clipIds.has(clipId.value))

// ── 诊断 ───────────────────────────────────────────────────────────────────────

const draftProblems = computed(() => {
  if (body.value === null) return []
  return validateBinding(body.value, { refs: props.refs, basePath: 'rule_bindings' })
})

const summary = computed(() => describeBinding(body.value ?? {}, { refs: props.refs }))

// ── 草稿写入 ────────────────────────────────────────────────────────────────────

function mutate(mutator: (draftBody: JsonObject) => void): void {
  if (props.draft === null || body.value === null) return
  mutator(body.value)
  props.draft.dirty = true
}

function setIdentityField(key: 'id' | 'rule' | 'clip', value: JsonValue | undefined): void {
  mutate((draftBody) => writeField(draftBody, key, value))
}

function setGateAt(raw: string): void {
  const parsed = parseNumberInput(raw)
  mutate((draftBody) => {
    const nextGate: JsonObject = {}
    if (parsed !== undefined) nextGate.at = parsed
    if (Object.keys(nextGate).length > 0) draftBody.gate = nextGate
    else delete draftBody.gate
  })
}

function setControl(value: JsonValue | undefined): void {
  mutate((draftBody) => writeField(draftBody, 'control', value))
}

// ── 调度 ────────────────────────────────────────────────────────────────────────

const scheduleKind = computed(() => (typeof schedule.value.on === 'string' ? schedule.value.on : ''))

function setScheduleKind(event: Event): void {
  const nextKind = (event.target as HTMLSelectElement).value
  mutate((draftBody) => {
    if (nextKind.length === 0) {
      delete draftBody.schedule
      return
    }
    draftBody.schedule = { on: nextKind }
  })
}

function setScheduleParam(key: 'clip' | 'at' | 'seconds' | 'binding', value: JsonValue | undefined): void {
  mutate((draftBody) => {
    const next: JsonObject = { ...asObject(draftBody.schedule) ?? {}, on: scheduleKind.value }
    writeField(next, key, value)
    draftBody.schedule = next
  })
}

function setScheduleFactName(value: JsonValue | undefined): void {
  mutate((draftBody) => {
    const next: JsonObject = { ...asObject(draftBody.schedule) ?? {}, on: 'fact' }
    writeField(next, 'fact', value)
    draftBody.schedule = next
  })
}

const scheduleClipOptions = computed(() => props.clips.map((clip) => clip.clipId ?? clip.clipKey))
const bindingOptions = computed(() => props.model.bindings.map((binding) => binding.ref.id))

// ── 出口 ────────────────────────────────────────────────────────────────────────

const exitKind = computed(() => (typeof exit.value.on_complete === 'string' ? exit.value.on_complete : ''))
const exitInfo = computed(() => (exitKind.value.length > 0 ? EXIT_KIND_INFO[exitKind.value] : undefined))

function setExitKind(event: Event): void {
  const nextKind = (event.target as HTMLSelectElement).value
  mutate((draftBody) => {
    if (nextKind.length === 0) {
      delete draftBody.exit
      return
    }
    const nextExit: JsonObject = { on_complete: nextKind }
    if (nextKind === 'goto') {
      const existing = asObject(draftBody.exit) ?? {}
      if (typeof existing.target === 'string') nextExit.target = existing.target
      if (isFiniteNumber(existing.entry_time)) nextExit.entry_time = existing.entry_time
    }
    draftBody.exit = nextExit
  })
}

function setExitTarget(value: JsonValue | undefined): void {
  mutate((draftBody) => {
    const next: JsonObject = { ...asObject(draftBody.exit) ?? {}, on_complete: exitKind.value }
    writeField(next, 'target', value)
    draftBody.exit = next
  })
}

function setExitEntryTime(raw: string): void {
  const parsed = parseNumberInput(raw)
  mutate((draftBody) => {
    const next: JsonObject = { ...asObject(draftBody.exit) ?? {}, on_complete: exitKind.value }
    writeField(next, 'entry_time', parsed)
    draftBody.exit = next
  })
}

const exitLegacyKeys = computed(() => {
  if (exitInfo.value?.allowsTarget) return []
  return ['target', 'entry_time'].filter((key) => exit.value[key] !== undefined)
})

// ── 规则引用跳转 ────────────────────────────────────────────────────────────────

const ruleRow = computed(() => props.model.ruleById.get(ruleId.value))

// 未登记字段：只读展示，不静默删除。
const bodyUnknown = computed(() =>
  body.value === null ? [] : unknownKeys(body.value, ['id', 'rule', 'clip', 'gate', 'control', 'schedule', 'exit']),
)
</script>

<template>
  <div class="binding-detail">
    <!-- 身份 -->
    <section class="binding-detail__section">
      <h3 class="binding-detail__heading">身份</h3>
      <FieldInput
        label="绑定 id"
        type="string"
        required
        :disabled="disabled"
        :value="body?.id"
        description="脚本内唯一；重命名事务性同步调度与条件树引用，一处失败整体不应用。"
        @update:value="(value) => setIdentityField('id', typeof value === 'string' ? value : undefined)"
      />
      <FieldInput
        label="规则"
        type="string"
        required
        :disabled="true"
        :value="ruleId"
        description="规则定义的增删改在规则详情；本页只读展示。"
      />
      <div :class="['binding-detail__clip', { 'binding-detail__clip--missing': missingClip }]">
        <label class="binding-detail__clip-label">
          片段
          <select :disabled="disabled" :value="clipId" @change="setIdentityField('clip', ($event.target as HTMLSelectElement).value || undefined)">
            <option value="">（未选择片段）</option>
            <option v-for="option in scheduleClipOptions" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <p v-if="missingClip" class="binding-detail__warn">片段不存在：本绑定不能应用，请先修复片段引用。</p>
      </div>
      <div v-if="bodyUnknown.length > 0" class="binding-detail__legacy">
        <span class="binding-detail__legacy-label">未登记字段（只读）：</span>
        <code v-for="key in bodyUnknown" :key="key">{{ key }}={{ JSON.stringify(body?.[key]) }}</code>
      </div>
    </section>

    <!-- 时间门 -->
    <section class="binding-detail__section">
      <h3 class="binding-detail__heading">时间门</h3>
      <label class="binding-detail__field">
        <span class="binding-detail__field-label">at（片段局部秒，≥ 0）</span>
        <input type="number" :value="numberText(gate.at)" :disabled="disabled" @input="setGateAt(($event.target as HTMLInputElement).value)" />
        <span class="binding-detail__hint">
          <template v-if="clipInfinite">无限片段：门值无上界。</template>
          <template v-else-if="clipDuration !== undefined">有限片段：at ≤ {{ clipDuration }}s；越界报错，不夹取。</template>
          <template v-else>片段时长未知：越界判定待片段解析后给出。</template>
        </span>
      </label>
    </section>

    <!-- 控制 -->
    <section class="binding-detail__section">
      <h3 class="binding-detail__heading">控制</h3>
      <select :disabled="disabled" :value="typeof body?.control === 'string' ? body.control : ''" @change="setControl(($event.target as HTMLSelectElement).value || undefined)">
        <option value="">观察（缺省，非阻塞）</option>
        <option v-for="kind in CONTROL_KINDS" :key="kind" :value="kind">{{ CONTROL_KIND_INFO[kind]?.label ?? kind }}</option>
      </select>
      <p v-if="body?.control === 'hold'" class="binding-detail__hint">
        持有不是动作；门后未成立时挂起实例，等待上限由规则 timeout 表达（-1 = 无限等待）。
      </p>
    </section>

    <!-- 调度 -->
    <section class="binding-detail__section">
      <h3 class="binding-detail__heading">调度</h3>
      <select :disabled="disabled" :value="scheduleKind" @change="setScheduleKind">
        <option value="">省略：判定成功后立即提交动作</option>
        <option v-for="kind in SCHEDULE_KINDS" :key="kind" :value="kind">{{ SCHEDULE_KIND_INFO[kind]?.label ?? kind }}</option>
      </select>

      <template v-if="scheduleKind.length > 0">
        <FieldInput
          v-if="['clip_start', 'clip_complete', 'local_time'].includes(scheduleKind)"
          label="目标片段"
          type="enum"
          required
          :disabled="disabled"
          :enum-values="scheduleClipOptions"
          :value="schedule.clip"
          description="可以是绑定自己的片段，也可以是别的已存在片段。"
          @update:value="(value) => setScheduleParam('clip', value)"
        />
        <FieldInput
          v-if="scheduleKind === 'local_time'"
          label="局部时间 at（≥ 0，不夹取）"
          type="float"
          required
          :disabled="disabled"
          :value="schedule.at"
          @update:value="(value) => setScheduleParam('at', value)"
        />
        <FieldInput
          v-if="scheduleKind === 'delay'"
          label="真实延迟秒数（≥ 0；挂起不冻结）"
          type="float"
          required
          :disabled="disabled"
          :value="schedule.seconds"
          @update:value="(value) => setScheduleParam('seconds', value)"
        />
        <template v-if="scheduleKind === 'fact'">
          <FieldInput
            label="等待绑定"
            type="enum"
            required
            :disabled="disabled"
            :enum-values="bindingOptions"
            :value="schedule.binding"
            description="允许前向引用；成环会被校验标出。"
            @update:value="(value) => setScheduleParam('binding', value)"
          />
          <FieldInput
            label="事实名"
            type="enum"
            required
            :disabled="disabled"
            :enum-values="RULE_FACT_NAMES"
            :value="schedule.fact"
            @update:value="setScheduleFactName"
          />
        </template>
      </template>
    </section>

    <!-- 出口 -->
    <section class="binding-detail__section">
      <h3 class="binding-detail__heading">出口</h3>
      <select :disabled="disabled" :value="exitKind" @change="setExitKind">
        <option value="">省略：继承片段默认出口</option>
        <option v-for="kind in EXIT_KINDS" :key="kind" :value="kind">{{ EXIT_KIND_INFO[kind]?.label ?? kind }}</option>
      </select>

      <template v-if="exitKind === 'goto'">
        <FieldInput
          label="目标片段"
          type="enum"
          required
          :disabled="disabled"
          :enum-values="scheduleClipOptions"
          :value="exit.target"
          @update:value="setExitTarget"
        />
        <label class="binding-detail__field">
          <span class="binding-detail__field-label">入口局部时间（≥ 0，缺省 0）</span>
          <input type="number" :value="numberText(exit.entry_time)" :disabled="disabled" @input="setExitEntryTime(($event.target as HTMLInputElement).value)" />
        </label>
      </template>

      <div v-if="exitLegacyKeys.length > 0" class="binding-detail__legacy">
        <span>当前出口类型不允许目标 / 入口时间（只读保留）：</span>
        <code v-for="key in exitLegacyKeys" :key="key">{{ key }}={{ JSON.stringify(exit[key]) }}</code>
      </div>

      <ul class="binding-detail__exit-notes">
        <li>只在本绑定的动作 `goto_clip` 启动分支时，作为该分支的出口策略。</li>
        <li>不作用于本绑定自己的片段完成；主线片段完成走片段默认出口。</li>
        <li>不作用于 `goto` 链的下一跳；下一跳用目标片段自身默认出口。</li>
        <li v-if="!row?.usesGotoClip">本绑定规则动作里没有 `goto_clip`：该出口未被本绑定 goto 使用。</li>
      </ul>
    </section>

    <!-- 运行摘要 -->
    <section class="binding-detail__section">
      <h3 class="binding-detail__heading">运行摘要</h3>
      <p class="binding-detail__summary">{{ summary }}</p>
    </section>

    <!-- 诊断 -->
    <section class="binding-detail__section">
      <h3 class="binding-detail__heading">诊断</h3>
      <ProblemList :problems="draftProblems" empty-text="当前草稿无诊断。" />
    </section>

    <!-- 操作 -->
    <section v-if="draft" class="binding-detail__actions">
      <button type="button" :disabled="disabled || missingClip" @click="emit('apply')">应用</button>
      <button type="button" :disabled="disabled" @click="emit('discard')">放弃</button>
      <button
        type="button"
        :disabled="disabled || referrers.length > 0"
        :title="referrers.length > 0 ? `仍被引用：${referrers.map((r) => r.detail).join('、')}` : ''"
        @click="emit('remove')"
      >
        删除绑定
      </button>
      <div v-if="referrers.length > 0" class="binding-detail__referrers">
        被引用位置：
        <ul>
          <li v-for="(referrer, index) in referrers" :key="index">{{ referrer.detail }}</li>
        </ul>
      </div>
      <button v-if="ruleRow" type="button" class="binding-detail__locate" @click="emit('locateRule', ruleRow.id)">
        定位到规则 {{ ruleRow.id }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.binding-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 12px;
  font-size: 11px;
}

.binding-detail__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.binding-detail__heading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.binding-detail__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.binding-detail__field-label {
  color: var(--text-secondary);
}

.binding-detail__hint {
  margin: 0;
  font-size: 10px;
  color: var(--text-muted);
}

.binding-detail__warn {
  margin: 0;
  font-size: 10px;
  color: var(--danger, #c0392b);
}

.binding-detail__clip--missing select {
  border-color: var(--danger, #c0392b);
}

.binding-detail__legacy {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 10px;
  color: var(--text-muted);
}

.binding-detail__exit-notes {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  color: var(--text-secondary);
}

.binding-detail__summary {
  margin: 0;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.binding-detail__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.binding-detail__referrers {
  width: 100%;
  font-size: 10px;
  color: var(--text-secondary);
}

.binding-detail__referrers ul {
  margin: 2px 0 0;
  padding-left: 16px;
}

.binding-detail__locate {
  margin-left: auto;
}

button,
select,
input {
  font: inherit;
}
</style>
