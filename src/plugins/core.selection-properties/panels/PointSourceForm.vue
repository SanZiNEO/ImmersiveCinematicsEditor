<script setup lang="ts">
/**
 * 点源五形态表单（07-03）：形态下拉 + 按形态切换的载荷字段。
 *
 * 只渲染与转发；校验走 `pointSourceFields.ts` 纯函数，写出字符串由父面板拼 ref。
 * 不直接提交命令。
 */
import { computed } from 'vue'
import type { RefKind } from '../../../features/authoring/pointSource.ts'
import {
  allowedKinds,
  validatePointDraft,
  type PointSourceDraft,
} from '../../../features/authoring/ui/pointSourceFields.ts'

const props = defineProps<{
  /** 字段路径（决定允许形态：facing_entity / yaw_base_selector 只允许 selector）。 */
  field: string
  draft: PointSourceDraft
  disabled?: boolean
  /** 覆盖该字段允许的形态（look_at 各分支按分支收窄）。 */
  kinds?: RefKind[]
}>()

const emit = defineEmits<{
  'update:draft': [draft: PointSourceDraft]
}>()

const KIND_LABELS: Record<RefKind, string> = {
  empty: '空',
  player: '玩家',
  coordinate: '坐标',
  block: '方块',
  selector: '选择器',
  structure: '结构',
}

const kinds = computed<RefKind[]>(() => props.kinds ?? allowedKinds(props.field))
const validation = computed(() => validatePointDraft(props.field, props.draft))

function patch(partial: Partial<PointSourceDraft>): void {
  emit('update:draft', { ...props.draft, ...partial })
}

function setKind(kind: RefKind): void {
  patch({ kind })
}

function setCoord(index: 0 | 1 | 2, raw: string): void {
  const coords: PointSourceDraft['coords'] = [...props.draft.coords]
  coords[index] = raw.trim() === '' ? null : Number(raw)
  patch({ coords })
}

function setText(text: string): void {
  patch({ text })
}

function setRadius(raw: string): void {
  const radius = raw.trim() === '' ? 16 : Number(raw)
  patch({ radius: Number.isFinite(radius) && radius > 0 ? Math.trunc(radius) : 16 })
}

function coordText(value: number | null): string {
  return value === null ? '' : String(value)
}
</script>

<template>
  <div class="ps-form" :class="{ 'ps-form--disabled': disabled }">
    <select
      class="ps-form__kind"
      :disabled="disabled"
      :value="draft.kind"
      @change="setKind(($event.target as HTMLSelectElement).value as RefKind)"
    >
      <option v-for="kind in kinds" :key="kind" :value="kind">{{ KIND_LABELS[kind] }}</option>
    </select>

    <template v-if="draft.kind === 'coordinate'">
      <label class="ps-form__coord">
        <span>X</span>
        <input
          type="number"
          :disabled="disabled"
          :value="coordText(draft.coords[0])"
          placeholder="0（未写 = 0）"
          @input="setCoord(0, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="ps-form__coord">
        <span>Y</span>
        <input
          type="number"
          :disabled="disabled"
          :value="coordText(draft.coords[1])"
          placeholder="0（未写 = 0）"
          @input="setCoord(1, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="ps-form__coord">
        <span>Z</span>
        <input
          type="number"
          :disabled="disabled"
          :value="coordText(draft.coords[2])"
          placeholder="0（未写 = 0）"
          @input="setCoord(2, ($event.target as HTMLInputElement).value)"
        />
      </label>
    </template>

    <template v-else-if="draft.kind === 'block'">
      <input
        class="ps-form__text"
        type="text"
        :disabled="disabled"
        placeholder="方块 id"
        :value="draft.text"
        @input="setText(($event.target as HTMLInputElement).value)"
      />
      <label class="ps-form__radius">
        <span>半径</span>
        <input
          type="number"
          min="1"
          :disabled="disabled"
          :value="draft.radius"
          @input="setRadius(($event.target as HTMLInputElement).value)"
        />
      </label>
    </template>

    <template v-else-if="draft.kind === 'selector'">
      <input
        class="ps-form__text"
        type="text"
        :disabled="disabled"
        placeholder="@p / uuid:…"
        :value="draft.text"
        @input="setText(($event.target as HTMLInputElement).value)"
      />
    </template>

    <template v-else-if="draft.kind === 'structure'">
      <input
        class="ps-form__text"
        type="text"
        :disabled="disabled"
        placeholder="结构 id"
        :value="draft.text"
        @input="setText(($event.target as HTMLInputElement).value)"
      />
    </template>

    <p v-if="validation.issues.length > 0" class="ps-form__issues" role="alert">
      {{ validation.issues.map((issue) => issue.message).join('；') }}
    </p>
  </div>
</template>

<style scoped>
.ps-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ps-form--disabled {
  opacity: 0.55;
}

.ps-form__kind,
.ps-form__text,
.ps-form__coord input,
.ps-form__radius input {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
}

.ps-form__text {
  min-width: 120px;
}

.ps-form__coord,
.ps-form__radius {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
}

.ps-form__issues {
  flex: 1 1 100%;
  margin: 0;
  color: var(--error);
  font-size: 11px;
}
</style>
