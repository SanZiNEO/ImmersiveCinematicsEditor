<script setup lang="ts">
/**
 * 触发器字段表单（05-13）。
 *
 * type / identity 只读；repeatable / delay / on_enter / exit_buffer / continuity
 * 走 `trigger.setFields`，patch 只带被改的脚本 JSON 键。失败保留当前值并显示错误，
 * 不乐观更新视图。
 */
import { computed, ref } from 'vue'
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { TriggerViewEntry } from '../../../workbench/api/documents.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import {
  cloneJsonObject,
  readNumberInput,
  type TriggerSetFieldsCommand,
} from '../helpers.ts'

const props = defineProps<{
  trigger: TriggerViewEntry
}>()

const ctx = usePanelContext()

const message = ref('')
const messageKind = ref<'info' | 'error'>('info')
const formKey = ref(0)

const continuity = computed<JsonObject>(() => cloneJsonObject(props.trigger.continuity))
const sweep = computed(() => props.trigger.continuity?.sweep === true)

function report(text: string, kind: 'info' | 'error'): void {
  message.value = text
  messageKind.value = kind
}

function commitFields(patch: JsonObject): boolean {
  const command: TriggerSetFieldsCommand = {
    kind: 'trigger.setFields',
    triggerIdentity: props.trigger.identity,
    patch,
  }
  const outcome = ctx.commands.commit(command as unknown as DocCommand)
  if (outcome.ok) {
    report('已更新触发器字段。', 'info')
    return true
  }
  report(outcome.error ?? '更新触发器字段失败。', 'error')
  formKey.value += 1
  return false
}

function onRepeatable(event: Event): void {
  const repeatable = (event.target as HTMLSelectElement).value === 'repeat'
  if (repeatable === props.trigger.repeatable) {
    return
  }
  commitFields({ repeatable })
}

function onOnEnter(event: Event): void {
  const onEnter = (event.target as HTMLInputElement).checked
  if (onEnter === props.trigger.onEnter) {
    return
  }
  commitFields({ on_enter: onEnter })
}

function onDelay(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  const parsed = readNumberInput(raw)
  if (parsed === 'invalid' || parsed === null || parsed < 0) {
    report('delay 必须是非负数字。', 'error')
    formKey.value += 1
    return
  }
  commitFields({ delay: parsed })
}

function onExitBuffer(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  const parsed = readNumberInput(raw)
  if (parsed === 'invalid' || parsed === null || parsed < 0) {
    report('exit_buffer 必须是非负数字。', 'error')
    formKey.value += 1
    return
  }
  commitFields({ exit_buffer: parsed })
}

function onSweep(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  const next = continuity.value
  next.sweep = checked
  commitFields({ continuity: next })
}

function continuityNumber(key: 'dwell' | 'window'): number {
  const value = props.trigger.continuity?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function onContinuityNumber(key: 'dwell' | 'window', event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  const parsed = readNumberInput(raw)
  if (parsed === 'invalid' || parsed === null || !Number.isInteger(parsed) || parsed < 0 || parsed > 1200) {
    report(`${key} 必须是 0–1200 的整数 tick。`, 'error')
    formKey.value += 1
    return
  }
  const next = continuity.value
  next[key] = parsed
  commitFields({ continuity: next })
}
</script>

<template>
  <section class="trigger-fields" aria-label="触发器字段">
    <header class="trigger-fields__head">
      <h3 class="trigger-fields__title">触发器字段</h3>
      <span class="trigger-fields__identity">{{ trigger.type }} · {{ trigger.identity }}</span>
      <span class="trigger-fields__readonly">type / identity 只读 · 声明下标 #{{ trigger.index }}</span>
    </header>

    <div :key="formKey" class="trigger-fields__grid">
      <label class="trigger-field">
        <span class="trigger-field__label">重复性</span>
        <select class="trigger-field__input" :value="trigger.repeatable ? 'repeat' : 'once'" @change="onRepeatable">
          <option value="once">单次</option>
          <option value="repeat">可重复</option>
        </select>
      </label>

      <label class="trigger-field">
        <span class="trigger-field__label">delay（秒）</span>
        <input
          class="trigger-field__input"
          type="number"
          min="0"
          step="any"
          :value="trigger.delay"
          @change="onDelay"
        />
      </label>

      <label class="trigger-field trigger-field--check">
        <input type="checkbox" :checked="trigger.onEnter" @change="onOnEnter" />
        <span class="trigger-field__label">on_enter</span>
      </label>

      <label class="trigger-field">
        <span class="trigger-field__label">exit_buffer（秒）</span>
        <input
          class="trigger-field__input"
          type="number"
          min="0"
          step="any"
          :value="trigger.exitBuffer"
          @change="onExitBuffer"
        />
      </label>

      <fieldset class="continuity">
        <legend class="trigger-field__label">continuity</legend>
        <label class="trigger-field trigger-field--check">
          <input type="checkbox" :checked="sweep" @change="onSweep" />
          <span>sweep（连续运动近似）</span>
        </label>
        <label class="trigger-field">
          <span class="trigger-field__label">dwell（tick，0–1200）</span>
          <input
            class="trigger-field__input"
            type="number"
            min="0"
            max="1200"
            step="1"
            :value="continuityNumber('dwell')"
            @change="onContinuityNumber('dwell', $event)"
          />
        </label>
        <label class="trigger-field">
          <span class="trigger-field__label">window（tick，0–1200）</span>
          <input
            class="trigger-field__input"
            type="number"
            min="0"
            max="1200"
            step="1"
            :value="continuityNumber('window')"
            @change="onContinuityNumber('window', $event)"
          />
        </label>
      </fieldset>
    </div>

    <p v-if="message !== ''" class="trigger-fields__message" :data-kind="messageKind" role="status" aria-live="polite">
      {{ message }}
    </p>
  </section>
</template>

<style scoped>
.trigger-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.trigger-fields__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.trigger-fields__title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.trigger-fields__identity {
  color: var(--text);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.trigger-fields__readonly {
  color: var(--text-muted);
  font-size: 10px;
}

.trigger-fields__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px 10px;
}

.trigger-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.trigger-field--check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.trigger-field__label {
  color: var(--text-muted);
  font-size: 11px;
}

.trigger-field__input {
  width: 100%;
  box-sizing: border-box;
  padding: 3px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.trigger-field__input:focus-visible,
.trigger-field--check input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.continuity {
  display: flex;
  flex-direction: column;
  gap: 4px;
  grid-column: 1 / -1;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.trigger-fields__message {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.trigger-fields__message[data-kind='error'] {
  color: var(--error);
}

@container (min-width: 460px) {
  .trigger-fields__grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
