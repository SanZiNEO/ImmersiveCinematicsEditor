<script setup lang="ts">
/**
 * 规则定义详情（11-06 / 11-07 / 11-08）。
 *
 * 分区：身份 → 条件 → 动作 → 策略 → 绑定（只读）→ 诊断。
 * 编辑全部落在记录级草稿上；应用 / 放弃由外壳统一提交。绑定是只读列表，编辑在绑定详情。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { isJsonObject, isJsonArray } from '../../../core/doc/json.ts'
import {
  POLICY_FIELDS,
  POLICY_DEFAULTS,
  type RuleFieldDef,
} from '../../../core/schema/catalog/behaviorRules.ts'
import type { BehaviorRefs } from '../../../core/schema/catalog/behaviorRules.ts'
import {
  validateRuleDefinition,
  validatePolicy,
} from '../../../features/behavior/rules.ts'
import { validateRuleCondition } from '../../../features/behavior/ruleConditions.ts'
import { validateActions as validateActionList } from '../../../features/behavior/actions.ts'
import type { RecordDraft } from './draftStore.ts'
import type { BehaviorModel, RuleRow } from './drawerModel.ts'
import { asObject, asArray, writeField, unknownKeys } from './shared/fields.ts'
import FieldInput from './shared/FieldInput.vue'
import ProblemList from './shared/ProblemList.vue'
import ConditionTreeEditor from './condition/ConditionTreeEditor.vue'
import ActionListEditor from './action/ActionListEditor.vue'

const props = defineProps<{
  row: RuleRow | null
  draft: RecordDraft | null
  refs: BehaviorRefs
  model: BehaviorModel
  disabled?: boolean
}>()

const emit = defineEmits<{
  apply: []
  discard: []
  duplicate: []
  remove: []
  migrate: [targetRuleId: string]
  locateBinding: [bindingId: string]
}>()

// ── 草稿体访问 ──────────────────────────────────────────────────────────────────

const body = computed<JsonObject | null>(() => props.draft?.body ?? null)

const policy = computed<JsonObject>(() => asObject(body.value?.policy) ?? {})
const condition = computed<JsonObject>(() => asObject(body.value?.condition) ?? {})
const actions = computed<JsonObject[]>(() => {
  const list = asArray(body.value?.actions)
  return list === null ? [] : list.filter(isJsonObject)
})

const timeout = computed<number>(() => {
  const raw = policy.value.timeout
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : POLICY_DEFAULTS.timeout
})
const hasTimeout = computed(() => timeout.value > 0)
const mode = computed(() => (policy.value.mode === 'dwell' ? 'dwell' : 'enter'))

// ── 草稿诊断（按当前草稿体现算；不回写文档）──────────────────────────────────────

const draftProblems = computed(() => {
  if (body.value === null) return []
  const index = props.row?.index ?? 0
  return validateRuleDefinition(body.value, index, props.refs)
})

const policyProblems = computed(() => validatePolicy(policy.value, props.refs))
const actionProblems = computed(() =>
  validateActionList(actions.value, { refs: props.refs, basePath: 'actions' }),
)
const timeoutActionProblems = computed(() =>
  validateActionList(onTimeoutActions.value, { refs: props.refs, timedOut: true, basePath: 'policy.on_timeout' }),
)
const conditionProblems = computed(() =>
  validateRuleCondition(condition.value, { refs: props.refs, basePath: 'condition' }),
)

// ── 草稿写入 ────────────────────────────────────────────────────────────────────

function mutate(mutator: (draftBody: JsonObject) => void): void {
  if (props.draft === null || body.value === null) return
  mutator(body.value)
  props.draft.dirty = true
}

function setPolicyField(field: RuleFieldDef, value: JsonValue | undefined): void {
  mutate((draftBody) => {
    const nextPolicy: JsonObject = { ...asObject(draftBody.policy) ?? {} }
    writeField(nextPolicy, field.key, value)
    draftBody.policy = nextPolicy
  })
}

function setCondition(node: JsonObject): void {
  mutate((draftBody) => {
    draftBody.condition = node
  })
}

function setActions(next: JsonObject[]): void {
  mutate((draftBody) => {
    draftBody.actions = next
  })
}

function setTimeoutActions(next: JsonObject[]): void {
  mutate((draftBody) => {
    const nextPolicy: JsonObject = { ...asObject(draftBody.policy) ?? {} }
    if (next.length === 0) delete nextPolicy.on_timeout
    else nextPolicy.on_timeout = next
    draftBody.policy = nextPolicy
  })
}

const onTimeoutActions = computed<JsonObject[]>(() => {
  const raw = asArray(policy.value.on_timeout)
  return raw === null ? [] : raw.filter(isJsonObject)
})

// ── 身份 / 引用保护 ────────────────────────────────────────────────────────────

const referrers = computed(() => (props.row === null ? [] : props.row.bindings))
const referenced = computed(() => referrers.value.length > 0)

// 未登记字段：只读展示，不静默删除。
const bodyUnknown = computed(() =>
  body.value === null ? [] : unknownKeys(body.value, ['id', 'condition', 'actions', 'policy']),
)
const policyUnknown = computed(() => unknownKeys(policy.value, POLICY_FIELDS.map((field) => field.key)))

// 空条件 / 空动作在应用时是错误：先禁止应用，引导补齐。
const applyBlocked = computed(() => actions.value.length === 0 || Object.keys(condition.value).length === 0)

const otherRules = computed(() => props.model.rules.filter((rule) => rule.id !== props.row?.id))

const migrationTarget = ref('')

function requestMigrate(): void {
  if (migrationTarget.value.length === 0) return
  emit('migrate', migrationTarget.value)
}

function setMigrationTarget(event: Event): void {
  migrationTarget.value = (event.target as HTMLSelectElement).value
}
</script>

<template>
  <div class="rule-detail">
    <!-- 身份 -->
    <section class="rule-detail__section">
      <h3 class="rule-detail__heading">身份</h3>
      <FieldInput
        label="规则 id"
        type="string"
        required
        :disabled="disabled"
        :value="body?.id"
        description="脚本内唯一；重命名会事务性同步全部绑定引用，一次撤销恢复。"
        @update:value="(value) => mutate((draftBody) => writeField(draftBody, 'id', typeof value === 'string' ? value : undefined))"
      />
      <p v-if="row" class="rule-detail__meta">
        被 {{ row.bindingCount }} 条绑定引用
        <span v-if="row.bindingCount === 0" class="rule-detail__unbound">（未绑定）</span>
      </p>
      <div v-if="bodyUnknown.length > 0" class="rule-detail__legacy">
        <span class="rule-detail__legacy-label">未登记字段（只读）：</span>
        <code v-for="key in bodyUnknown" :key="key">{{ key }}={{ JSON.stringify(body?.[key]) }}</code>
      </div>
    </section>

    <!-- 条件 -->
    <section class="rule-detail__section">
      <h3 class="rule-detail__heading">条件</h3>
      <ConditionTreeEditor
        :condition="condition"
        :refs="refs"
        :disabled="disabled"
        @update:condition="setCondition"
      />
      <ProblemList :problems="conditionProblems" />
    </section>

    <!-- 动作 -->
    <section class="rule-detail__section">
      <h3 class="rule-detail__heading">动作</h3>
      <p class="rule-detail__note">全部动作作用于触发这条规则的播放实例，没有动作级目标选择器。</p>
      <p class="rule-detail__note">
        三种退出 / 跳转的区别：动作 `goto_clip` 是规则成立时立刻开新分支；绑定 `exit.goto` 是分支完成后的去向；动作 `exit` 是结束当前播放实例。
      </p>
      <ActionListEditor :actions="actions" :refs="refs" :timed-out="false" :disabled="disabled" @update:actions="setActions" />
      <ProblemList :problems="actionProblems" />
    </section>

    <!-- 策略 -->
    <section class="rule-detail__section">
      <h3 class="rule-detail__heading">策略</h3>
      <div class="rule-detail__policy">
        <FieldInput
          v-for="field in POLICY_FIELDS.filter((item) => item.key !== 'on_timeout')"
          :key="field.key"
          :label="field.label"
          :type="field.type"
          :required="field.required"
          :disabled="disabled || (field.key === 'dwell' && mode === 'enter')"
          :enum-values="field.enumValues"
          :description="field.description"
          :value="policy[field.key]"
          @update:value="(value) => setPolicyField(field, value)"
        />
      </div>
      <div v-if="policyUnknown.length > 0" class="rule-detail__legacy">
        <span class="rule-detail__legacy-label">未登记策略字段（只读）：</span>
        <code v-for="key in policyUnknown" :key="key">{{ key }}={{ JSON.stringify(policy[key]) }}</code>
      </div>
      <p v-if="mode === 'dwell'" class="rule-detail__note">
        dwell=0 仍是驻留模式（实际等同立即），不会自动改回 enter。
      </p>
      <p v-if="!hasTimeout" class="rule-detail__note">
        无超时（timeout=-1 无限等待）：超时动作不会执行；已有内容只读保留。
      </p>

      <div class="rule-detail__timeout">
        <h4 class="rule-detail__subheading">超时动作</h4>
        <ActionListEditor
          :actions="onTimeoutActions"
          :refs="refs"
          timed-out
          :disabled="disabled || !hasTimeout"
          @update:actions="setTimeoutActions"
        />
        <ProblemList :problems="timeoutActionProblems" />
      </div>
      <ProblemList :problems="policyProblems" />
    </section>

    <!-- 绑定（只读） -->
    <section class="rule-detail__section">
      <h3 class="rule-detail__heading">绑定</h3>
      <p v-if="referrers.length === 0" class="rule-detail__note">未被任何绑定引用；新增绑定需先在工具条选择本规则。</p>
      <ul v-else class="rule-detail__bindings">
        <li v-for="binding in referrers" :key="binding.ref.id">
          <button type="button" class="rule-detail__binding" @click="emit('locateBinding', binding.ref.id)">
            {{ binding.summary }}
          </button>
        </li>
      </ul>
    </section>

    <!-- 诊断 -->
    <section class="rule-detail__section">
      <h3 class="rule-detail__heading">诊断</h3>
      <ProblemList :problems="draftProblems" empty-text="当前草稿无诊断。" />
    </section>

    <!-- 操作 -->
    <section v-if="draft" class="rule-detail__actions">
      <button type="button" :disabled="disabled || applyBlocked" :title="applyBlocked ? '条件与动作至少各一条后才能应用' : ''" @click="emit('apply')">应用</button>
      <button type="button" :disabled="disabled" @click="emit('discard')">放弃</button>
      <button v-if="!draft.isNew" type="button" :disabled="disabled" @click="emit('duplicate')">复制规则</button>
      <template v-if="!draft.isNew">
        <button
          type="button"
          :disabled="disabled || referenced"
          :title="referrers.length > 0 ? `仍被绑定引用：${referrers.map((b) => b.ref.id).join('、')}` : ''"
          @click="emit('remove')"
        >
          删除规则
        </button>
        <div v-if="referrers.length > 0" class="rule-detail__migrate">
          <span>受影响绑定：{{ referrers.map((b) => b.ref.id).join('、') }}</span>
          <select :value="migrationTarget" @change="setMigrationTarget">
            <option value="">迁移到规则…</option>
            <option v-for="other in otherRules" :key="other.id" :value="other.id">{{ other.id }}</option>
          </select>
          <button type="button" :disabled="disabled || migrationTarget.length === 0" @click="requestMigrate">
            迁移绑定后删除
          </button>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.rule-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 12px;
  font-size: 11px;
}

.rule-detail__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rule-detail__heading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.rule-detail__subheading {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
}

.rule-detail__meta {
  margin: 0;
  color: var(--text-secondary);
}

.rule-detail__unbound {
  color: var(--text-muted);
}

.rule-detail__note {
  margin: 0;
  font-size: 10px;
  color: var(--text-muted);
}

.rule-detail__legacy {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--text-muted);
}

.rule-detail__legacy-label {
  color: var(--text-secondary);
}

.rule-detail__legacy code {
  font-family: var(--font-mono, monospace);
}

.rule-detail__policy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rule-detail__timeout {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rule-detail__bindings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rule-detail__binding {
  font: inherit;
  text-align: left;
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
}

.rule-detail__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.rule-detail__migrate {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
  font-size: 10px;
  color: var(--text-secondary);
}

button,
select {
  font: inherit;
}
</style>
