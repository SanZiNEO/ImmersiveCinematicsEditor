<script setup lang="ts">
/**
 * 身份区（11-02）：id 输入 + 类型下拉 + 旧字段只读块 + 点名清理动作。
 *
 * - id：正则 + 脚本内唯一；重复 id 阻止保存与推送；留空走合成身份 `type#下标`；
 * - 类型：27 种目录声明顺序、可搜索、不按中文分组；未知类型原文只读；
 * - 切类型不静默丢旧条件：不适用键进「旧字段」只读块；清理动作只有点名才删。
 */
import { computed, ref } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import {
  TRIGGER_ID_PATTERN,
  TRIGGER_IDENTITY_NOTE,
  legacyConditionKeys,
  parseTriggerNode,
  unsupportedTimingKeys,
} from '../../../features/behavior/trigger.ts'
import { TRIGGER_TYPES, triggerTypeInfo } from '../../../core/schema/catalog/behaviorTriggers.ts'
import type { PanelTrigger } from './triggerPanelModel.ts'

const props = defineProps<{
  draft: JsonObject
  row: PanelTrigger | null
  existingIds: string[]
}>()

const emit = defineEmits<{ 'clean-inapplicable': [keys: string[]] }>()

const typeQuery = ref('')

const index = computed(() => props.row?.node.index ?? 0)
const node = computed(() => parseTriggerNode(props.draft, index.value))
const info = computed(() => node.value.info)

const draftId = computed<string>(() =>
  typeof props.draft.id === 'string' ? props.draft.id : '',
)

/** 清空后的回落身份预览（正常状态，不是错误）。 */
const syntheticPreview = computed(
  () => `${String(props.draft.type ?? 'unknown')}#${index.value}`,
)

const idError = computed<string | null>(() => {
  if (draftId.value.length === 0) return null
  if (!TRIGGER_ID_PATTERN.test(draftId.value)) {
    return `id 必须匹配 ${TRIGGER_ID_PATTERN.source}`
  }
  const ownId = props.row?.node.explicitId
  const duplicated = props.existingIds.some(
    (candidate) => candidate === draftId.value && candidate !== ownId,
  )
  if (duplicated) return `id「${draftId.value}」与其他触发器重复`
  return null
})

const filteredTypes = computed(() => {
  const query = typeQuery.value.trim().toLowerCase()
  if (query.length === 0) return TRIGGER_TYPES
  return TRIGGER_TYPES.filter(
    (entry) =>
      entry.type.toLowerCase().includes(query) || entry.label.toLowerCase().includes(query),
  )
})

const legacyCondition = computed(() => legacyConditionKeys(node.value))
const legacyTiming = computed(() => unsupportedTimingKeys(props.draft, info.value))
const cleanableKeys = computed(() => [...legacyCondition.value, ...legacyTiming.value])

function onIdInput(event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.value.length === 0) {
    delete props.draft.id
    return
  }
  props.draft.id = target.value
}

function onTypeChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  props.draft.type = target.value
}

function requestClean(): void {
  if (cleanableKeys.value.length === 0) return
  emit('clean-inapplicable', [...cleanableKeys.value])
}
</script>

<template>
  <section class="identity" aria-label="身份">
    <h3 class="section-title">身份</h3>

    <label class="identity__field">
      <span class="identity__label">触发器 id</span>
      <input
        class="identity__input"
        type="text"
        :value="draftId"
        :aria-invalid="idError !== null"
        placeholder="留空则生成 type#下标"
        @input="onIdInput"
      />
      <span v-if="idError" class="identity__error" role="alert">{{ idError }}</span>
      <span v-if="draftId.length === 0" class="identity__note">
        留空：身份回落为 {{ syntheticPreview }}（正常状态，不参与唯一性冲突）
      </span>
      <span class="identity__note">{{ TRIGGER_IDENTITY_NOTE }}</span>
    </label>

    <label class="identity__field">
      <span class="identity__label">类型</span>
      <input
        v-if="info === undefined"
        class="identity__input"
        type="text"
        :value="String(draft.type ?? '')"
        readonly
        :aria-label="'未知类型，原文只读'"
      />
      <template v-else>
        <input
          v-model="typeQuery"
          class="identity__search"
          type="text"
          placeholder="搜索类型…"
        />
        <select class="identity__input" :value="String(draft.type ?? '')" @change="onTypeChange">
          <option v-for="entry in filteredTypes" :key="entry.type" :value="entry.type">
            {{ entry.label }}（{{ entry.type }}）
          </option>
        </select>
      </template>
    </label>

    <div v-if="cleanableKeys.length > 0" class="identity__legacy">
      <p class="identity__legacy-title">旧字段 / 不适用字段（只读）</p>
      <ul>
        <li v-for="key in legacyCondition" :key="`cond:${key}`">conditions.{{ key }}</li>
        <li v-for="key in legacyTiming" :key="`timing:${key}`">{{ key }}</li>
      </ul>
      <button type="button" class="identity__clean" @click="requestClean">
        清理不适用字段（仅点名删除）
      </button>
    </div>
  </section>
</template>

<style scoped>
.identity {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
}

.section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.identity__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.identity__label {
  font-size: 11px;
  color: var(--text-muted, #999);
}

.identity__input,
.identity__search {
  font: inherit;
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--panel-bg, #1c1c1c);
  color: var(--text, #eee);
}

.identity__error {
  font-size: 11px;
  color: var(--error, #e05555);
}

.identity__note {
  font-size: 11px;
  color: var(--text-muted, #999);
}

.identity__legacy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px dashed var(--border, #444);
  border-radius: 4px;
  font-size: 11px;
}

.identity__legacy-title {
  margin: 0;
  color: var(--text-muted, #999);
}

.identity__legacy ul {
  margin: 0;
  padding-left: 16px;
}

.identity__clean {
  align-self: flex-start;
  font: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--panel-bg, #222);
  color: var(--text, #eee);
  cursor: pointer;
}
</style>
