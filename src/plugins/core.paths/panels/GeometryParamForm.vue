<script setup lang="ts">
/**
 * 07-06 几何参数表单（纯展示 + 事件转发）。
 *
 * 控件清单 / 枚举 / 默认值 / 锚点类别由 `features/paths/geometryForm.ts` 从 catalog 派生；
 * 数量 / 范围 / 互斥校验复用 core `validateGeometry`，错误按 `geometry.xxx` 定位到行。
 * 未知类型 / 未知参数只读保留并挂警告。
 */
import { computed } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { GeometryIssue } from '../../../core/paths/geometry.ts'
import {
  detectPointMode,
  geometryTypeOptions,
  type GeometryFormModel,
  type ParamControl,
  type PointMode,
} from '../../../features/paths/geometryForm.ts'

const props = defineProps<{
  model: GeometryFormModel
  geometry: JsonObject | undefined
  issues: readonly GeometryIssue[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'change-type': [type: string]
  'update-param': [key: string, value: JsonValue]
  'list-op': [key: string, op: 'add' | 'remove' | 'up' | 'down', index: number]
  'point-mode': [key: string, index: number, mode: PointMode]
}>()

const typeOptions = geometryTypeOptions()

function paramValue(key: string): JsonValue | undefined {
  return props.geometry?.[key]
}

function issuesFor(key: string): GeometryIssue[] {
  return props.issues.filter((issue) => {
    const rest = issue.field.replace(/^geometry\./, '')
    return rest === key || rest.startsWith(`${key}.`) || rest.startsWith(`${key}[`)
  })
}

function issueMessages(key: string): string[] {
  return issuesFor(key).map((issue) => issue.message)
}

function onTypeChange(event: Event): void {
  emit('change-type', (event.target as HTMLSelectElement).value)
}

function onNumberInput(key: string, event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  if (raw === '') {
    emit('update-param', key, null)
    return
  }
  emit('update-param', key, Number(raw))
}

function onTextInput(key: string, event: Event): void {
  emit('update-param', key, (event.target as HTMLInputElement).value)
}

function onBooleanChange(key: string, event: Event): void {
  emit('update-param', key, (event.target as HTMLInputElement).checked)
}

function onEnumChange(key: string, event: Event): void {
  emit('update-param', key, (event.target as HTMLSelectElement).value)
}

function pointList(key: string): JsonObject[] {
  const value = paramValue(key)
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is JsonObject => typeof item === 'object' && item !== null && !Array.isArray(item))
}

function numberList(key: string): number[] {
  const value = paramValue(key)
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
}

function onPointComponent(key: string, index: number, component: string, event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  const current = index < 0
    ? (paramValue(key) as JsonObject | undefined)
    : pointList(key)[index]
  const next: JsonObject = { ...(current ?? {}) }
  next[component] = raw === '' ? 0 : Number(raw)
  if (index < 0) {
    emit('update-param', key, next)
  } else {
    const list = pointList(key).map((item, itemIndex) => (itemIndex === index ? next : item))
    emit('update-param', key, list)
  }
}

function onPointMode(key: string, index: number, mode: PointMode): void {
  emit('point-mode', key, index, mode)
}

function onVectorComponent(key: string, component: string, event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  const current = (paramValue(key) as JsonObject | undefined) ?? {}
  emit('update-param', key, { ...current, [component]: raw === '' ? 0 : Number(raw) })
}

const anchorBadgeClass = computed(() => ({
  'geom-form__anchor--free': props.model.anchor === 'FREE',
  'geom-form__anchor--start': props.model.anchor === 'START',
  'geom-form__anchor--endpoints': props.model.anchor === 'ENDPOINTS',
}))
</script>

<template>
  <div class="geom-form">
    <div class="geom-form__row">
      <label class="geom-form__label" for="geom-type">类型</label>
      <select
        id="geom-type"
        class="geom-form__select"
        :value="props.model.rawType"
        :disabled="props.disabled"
        @change="onTypeChange"
      >
        <option v-for="option in typeOptions" :key="option" :value="option">{{ option }}</option>
      </select>
      <span class="geom-form__anchor" :class="anchorBadgeClass">{{ props.model.anchorLabel }}</span>
    </div>

    <p v-for="warning in props.model.warnings" :key="warning" class="geom-form__warning" role="alert">
      {{ warning }}
    </p>

    <template v-if="!props.model.known">
      <p class="geom-form__readonly-note">未知类型：参数原样保留，不提供控件编辑。</p>
    </template>

    <template v-for="control in props.model.controls" :key="control.key">
      <div class="geom-form__row" :class="{ 'geom-form__row--error': issuesFor(control.key).length > 0 }">
        <!-- 数值 -->
        <template v-if="control.kind === 'NUMBER' || control.kind === 'INTEGER'">
          <label class="geom-form__label" :for="`geom-${control.key}`">{{ control.key }}</label>
          <input
            :id="`geom-${control.key}`"
            class="geom-form__input"
            type="number"
            :step="control.kind === 'INTEGER' ? 1 : 0.001"
            :value="typeof paramValue(control.key) === 'number' ? (paramValue(control.key) as number) : ''"
            :disabled="props.disabled"
            @input="onNumberInput(control.key, $event)"
          />
        </template>

        <!-- 开关 -->
        <template v-else-if="control.kind === 'BOOLEAN'">
          <label class="geom-form__label" :for="`geom-${control.key}`">{{ control.key }}</label>
          <input
            :id="`geom-${control.key}`"
            type="checkbox"
            :checked="paramValue(control.key) === true"
            :disabled="props.disabled"
            @change="onBooleanChange(control.key, $event)"
          />
        </template>

        <!-- 枚举 -->
        <template v-else-if="control.kind === 'ENUM'">
          <label class="geom-form__label" :for="`geom-${control.key}`">{{ control.key }}</label>
          <select
            :id="`geom-${control.key}`"
            class="geom-form__select"
            :value="String(paramValue(control.key) ?? '')"
            :disabled="props.disabled"
            @change="onEnumChange(control.key, $event)"
          >
            <option v-for="option in control.enumValues" :key="option" :value="option">{{ option }}</option>
          </select>
        </template>

        <!-- 文本 -->
        <template v-else-if="control.kind === 'TEXT'">
          <label class="geom-form__label" :for="`geom-${control.key}`">{{ control.key }}</label>
          <input
            :id="`geom-${control.key}`"
            class="geom-form__input"
            type="text"
            :value="String(paramValue(control.key) ?? '')"
            :disabled="props.disabled"
            @input="onTextInput(control.key, $event)"
          />
        </template>

        <!-- 单点：绝对 / 相对二选一 -->
        <template v-else-if="control.kind === 'POINT'">
          <div class="geom-form__point">
            <div class="geom-form__row">
              <span class="geom-form__label">{{ control.key }}</span>
              <label class="geom-form__mode">
                <input
                  type="radio"
                  name="point-{{ control.key }}"
                  value="absolute"
                  :checked="detectPointMode(paramValue(control.key)) === 'absolute'"
                  :disabled="props.disabled"
                  @change="onPointMode(control.key, -1, 'absolute')"
                />
                绝对
              </label>
              <label class="geom-form__mode">
                <input
                  type="radio"
                  name="point-{{ control.key }}"
                  value="relative"
                  :checked="detectPointMode(paramValue(control.key)) === 'relative'"
                  :disabled="props.disabled"
                  @change="onPointMode(control.key, -1, 'relative')"
                />
                相对
              </label>
            </div>
            <div class="geom-form__point-components">
              <template v-for="component in (detectPointMode(paramValue(control.key)) === 'relative' ? ['dx', 'dy', 'dz'] : ['x', 'y', 'z'])" :key="component">
                <label class="geom-form__component">
                  {{ component }}
                  <input
                    class="geom-form__input"
                    type="number"
                    step="0.001"
                    :value="Number((paramValue(control.key) as JsonObject | undefined)?.[component] ?? 0)"
                    :disabled="props.disabled"
                    @input="onPointComponent(control.key, -1, component, $event)"
                  />
                </label>
              </template>
            </div>
          </div>
        </template>

        <!-- 点列表 -->
        <template v-else-if="control.kind === 'POINT_LIST'">
          <div class="geom-form__list">
            <div class="geom-form__row">
              <span class="geom-form__label">{{ control.key }}</span>
              <button
                type="button"
                class="geom-form__button"
                :disabled="props.disabled"
                @click="emit('list-op', control.key, 'add', -1)"
              >
                添加点
              </button>
            </div>
            <div v-for="(point, index) in pointList(control.key)" :key="index" class="geom-form__point geom-form__point--row">
              <div class="geom-form__row">
                <span class="geom-form__index">#{{ index + 1 }}</span>
                <label class="geom-form__mode">
                  <input
                    type="radio"
                    :name="`${control.key}-${index}-abs`"
                    value="absolute"
                    :checked="detectPointMode(point) === 'absolute'"
                    :disabled="props.disabled"
                    @change="onPointMode(control.key, index, 'absolute')"
                  />
                  绝对
                </label>
                <label class="geom-form__mode">
                  <input
                    type="radio"
                    :name="`${control.key}-${index}-rel`"
                    value="relative"
                    :checked="detectPointMode(point) === 'relative'"
                    :disabled="props.disabled"
                    @change="onPointMode(control.key, index, 'relative')"
                  />
                  相对
                </label>
                <button type="button" class="geom-form__button" :disabled="props.disabled || index === 0" @click="emit('list-op', control.key, 'up', index)">↑</button>
                <button type="button" class="geom-form__button" :disabled="props.disabled || index === pointList(control.key).length - 1" @click="emit('list-op', control.key, 'down', index)">↓</button>
                <button type="button" class="geom-form__button geom-form__button--danger" :disabled="props.disabled" @click="emit('list-op', control.key, 'remove', index)">删除</button>
              </div>
              <div class="geom-form__point-components">
                <template v-for="component in (detectPointMode(point) === 'relative' ? ['dx', 'dy', 'dz'] : ['x', 'y', 'z'])" :key="component">
                  <label class="geom-form__component">
                    {{ component }}
                    <input
                      class="geom-form__input"
                      type="number"
                      step="0.001"
                      :value="Number(point[component] ?? 0)"
                      :disabled="props.disabled"
                      @input="onPointComponent(control.key, index, component, $event)"
                    />
                  </label>
                </template>
              </div>
            </div>
          </div>
        </template>

        <!-- 数值列表 -->
        <template v-else-if="control.kind === 'NUMBER_LIST'">
          <div class="geom-form__list">
            <div class="geom-form__row">
              <span class="geom-form__label">{{ control.key }}</span>
              <button type="button" class="geom-form__button" :disabled="props.disabled" @click="emit('list-op', control.key, 'add', -1)">添加数值</button>
            </div>
            <div v-for="(item, index) in numberList(control.key)" :key="index" class="geom-form__row">
              <span class="geom-form__index">#{{ index + 1 }}</span>
              <input
                class="geom-form__input"
                type="number"
                step="0.001"
                :value="item"
                :disabled="props.disabled"
                @input="emit('update-param', control.key, numberList(control.key).map((value, itemIndex) => itemIndex === index ? Number(($event.target as HTMLInputElement).value) : value))"
              />
              <button type="button" class="geom-form__button geom-form__button--danger" :disabled="props.disabled" @click="emit('list-op', control.key, 'remove', index)">删除</button>
            </div>
          </div>
        </template>

        <!-- 向量 -->
        <template v-else-if="control.kind === 'VECTOR'">
          <div class="geom-form__point-components">
            <label v-for="component in ['x', 'y', 'z']" :key="component" class="geom-form__component">
              {{ component }}
              <input
                class="geom-form__input"
                type="number"
                step="0.001"
                :value="Number((paramValue(control.key) as JsonObject | undefined)?.[component] ?? 0)"
                :disabled="props.disabled"
                @input="onVectorComponent(control.key, component, $event)"
              />
            </label>
          </div>
        </template>

        <span v-else class="geom-form__readonly-note">未支持的控件形态: {{ control.kind }}</span>
      </div>

      <p v-for="message in issueMessages(control.key)" :key="message" class="geom-form__error" role="alert">
        {{ message }}
      </p>
    </template>

    <!-- 未知参数：只读保留 -->
    <div v-for="entry in props.model.unknownParams" :key="entry.key" class="geom-form__row">
      <span class="geom-form__label">{{ entry.key }}</span>
      <code class="geom-form__unknown">{{ JSON.stringify(entry.value) }}</code>
    </div>
  </div>
</template>

<style scoped>
.geom-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.geom-form__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.geom-form__row--error {
  border-left: 2px solid var(--error);
  padding-left: 6px;
}

.geom-form__label {
  flex: 0 0 90px;
  color: var(--text-secondary);
  font-size: 11px;
}

.geom-form__select,
.geom-form__input {
  min-width: 70px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.geom-form__anchor {
  margin-left: auto;
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.geom-form__anchor--free {
  border-color: var(--accent);
  color: var(--accent);
}

.geom-form__anchor--start {
  border-color: var(--warning);
  color: var(--warning);
}

.geom-form__point {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 100%;
}

.geom-form__point-components {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.geom-form__component {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
}

.geom-form__mode {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--text-secondary);
  font-size: 11px;
}

.geom-form__index {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.geom-form__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 100%;
}

.geom-form__button {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.geom-form__button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.geom-form__button--danger {
  color: var(--error);
}

.geom-form__warning,
.geom-form__error {
  margin: 0;
  color: var(--warning);
  font-size: 11px;
}

.geom-form__error {
  color: var(--error);
}

.geom-form__readonly-note {
  color: var(--text-muted);
  font-size: 11px;
}

.geom-form__unknown {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
