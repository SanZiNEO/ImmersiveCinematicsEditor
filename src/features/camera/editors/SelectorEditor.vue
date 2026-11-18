<script setup lang="ts">
/**
 * 选择器策略编辑器（08-01 §三 / §4.3）：通用 6 行 + 7 个调用点各 6 行覆盖。
 *
 * 规则：
 * - 字段集合与调用点全部由 `selectorLayout(catalog)` 从目录推导，不手写字段名或调用点名；
 * - 通用与覆盖字段都复用 06 的 `PropertyValueForm` 渲染；它自己做校验与 `object.setValue`，本组件忽略其 commit emit；
 * - 覆盖值为空（路径未显式写入）= 继承通用；编辑后写显式值；每行"清除"按钮走 `object.remove` 回到空；
 * - 布局：先通用 6 行平铺，再 7 组按调用点折叠（默认收起，组头显示调用点名 + 该组已设置覆盖数）；
 * - 已打帧的叶子已搬去效果面板：这里用 `staticRows` 过滤，只显示"该行已打帧，在效果面板编辑"提示。
 */
import { computed, reactive } from 'vue'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import {
  rowIsAnimated,
  selectorLayout,
  staticRows,
  type CameraEditorInput,
  type SelectorCallpoint,
  type SelectorField,
} from '../fieldSurface.ts'
import type { PropertyRow } from '../../effects/types.ts'
import PropertyValueForm from '../../effects/panels/PropertyValueForm.vue'
import { animatedRowCount } from './editorRows.ts'

const props = defineProps<CameraEditorInput>()

const panel = usePanelContext()

/** 从目录推导的布局（通用 6 + 7 调用点各 6）。 */
const layout = computed(() => selectorLayout(props.catalog))

/** 留在属性面板的静态行（已打帧叶子不在此列）。 */
const staticByPath = computed(() => new Map(staticRows(props.rows).map((row) => [row.path, row])))

/** 全部行（含已打帧）按路径索引，用于判定某行是否已搬去效果面板。 */
const allByPath = computed(() => new Map(props.rows.map((row) => [row.path, row])))

/** 通用 6 行。 */
const genericRows = computed<PropertyRow[]>(() =>
  layout.value.generic
    .map((field) => staticByPath.value.get(field.path))
    .filter((row): row is PropertyRow => row !== undefined),
)

/** 通用字段名 → 通用行（覆盖行继承提示用）。 */
const genericByField = computed(() => new Map(layout.value.generic.map((field) => [field.field, field])))

/** 通用字段已打帧行数（归效果面板，只做计数提示）。 */
const genericAnimatedCount = computed(() =>
  animatedRowCount(props.rows, layout.value.generic.map((field) => field.path)),
)

/** 一个覆盖字段是否为空（未显式写入静态值）。 */
function isOverrideEmpty(row: PropertyRow | undefined): boolean {
  if (row === undefined) {
    return true
  }
  return !row.hasValue
}

/** 覆盖行对应的通用行（按字段名配对）。 */
function genericRowOf(field: SelectorField): PropertyRow | undefined {
  const generic = genericByField.value.get(field.field)
  return generic === undefined ? undefined : staticByPath.value.get(generic.path)
}

/** 通用当前值的可读描述（继承提示用）；取不到时给空串。 */
function genericValueText(field: SelectorField): string {
  const generic = genericRowOf(field)
  if (generic === undefined) {
    return ''
  }
  const raw = generic.hasValue ? generic.value : generic.defaultValue
  return describeValue(raw)
}

/** 把 JSON 值压成短文案（不夹紧、不换算）。 */
function describeValue(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return ''
  }
  if (typeof raw === 'string') {
    return raw
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw)
  }
  try {
    const text = JSON.stringify(raw)
    return text === undefined ? String(raw) : text
  } catch {
    return String(raw)
  }
}

/** 清除覆盖：删路径回到继承通用。 */
function clearOverride(field: SelectorField): void {
  if (props.disabled) {
    return
  }
  panel.commands.commit({ kind: 'object.remove', clipKey: props.clipKey, path: field.path })
}

/** 覆盖字段在静态行集合中的行（未派生 / 已打帧时为 `undefined`）。 */
function staticRowOf(field: SelectorField): PropertyRow | undefined {
  return staticByPath.value.get(field.path)
}

/** 覆盖字段渲染条目：静态行 + 空态 / 打帧标记。 */
interface OverrideEntry {
  field: SelectorField
  row: PropertyRow | undefined
  animated: boolean
}

/** 一组覆盖字段的渲染条目（目录顺序）。 */
function overrideEntries(callpoint: SelectorCallpoint): OverrideEntry[] {
  return callpoint.fields.map((field) => {
    const row = staticRowOf(field)
    const animated = row === undefined && animatedRowOf(field)
    return { field, row, animated }
  })
}

/** 某组已设置覆盖数（显式静态值的行数；折叠摘要用）。 */
function overrideCount(callpoint: SelectorCallpoint): number {
  return callpoint.fields.reduce((count, field) => {
    const row = staticRowOf(field)
    return count + (row !== undefined && row.hasValue ? 1 : 0)
  }, 0)
}

/** 某字段是否已打帧（行在全量集合中且 keyframes 非空）。 */
function animatedRowOf(field: SelectorField): boolean {
  const row = allByPath.value.get(field.path)
  return row !== undefined && rowIsAnimated(row)
}

/** 折叠状态：调用点名 → 是否展开（默认收起）。 */
const openGroups = reactive<Record<string, boolean>>({})

function toggleGroup(callpoint: string): void {
  openGroups[callpoint] = !openGroups[callpoint]
}

/** 组内已打帧行数（提示计数用）。 */
function animatedCount(callpoint: SelectorCallpoint): number {
  return callpoint.fields.reduce((count, field) => count + (animatedRowOf(field) ? 1 : 0), 0)
}
</script>

<template>
  <div class="selector-editor">
    <div class="selector-editor__generic">
      <PropertyValueForm
        v-for="row in genericRows"
        :key="row.path"
        :row="row"
        panel="properties"
        :playhead="playhead"
        :disabled="disabled"
      />
      <p v-if="genericAnimatedCount > 0" class="selector-editor__animated-note" role="status">
        {{ genericAnimatedCount }} 行已打帧，不在本面板编辑
      </p>
    </div>

    <div
      v-for="callpoint in layout.callpoints"
      :key="callpoint.callpoint"
      class="selector-editor__group"
    >
      <button
        type="button"
        class="selector-editor__group-head"
        :aria-expanded="openGroups[callpoint.callpoint] === true"
        :aria-label="`调用点 ${callpoint.callpoint} 覆盖字段`"
        @click="toggleGroup(callpoint.callpoint)"
      >
        <span class="selector-editor__group-caret">
          {{ openGroups[callpoint.callpoint] === true ? '▾' : '▸' }}
        </span>
        <span class="selector-editor__group-name">{{ callpoint.callpoint }}</span>
        <span class="selector-editor__group-count">已设置 {{ overrideCount(callpoint) }} 项</span>
      </button>

      <div v-if="openGroups[callpoint.callpoint] === true" class="selector-editor__group-body">
        <div v-for="entry in overrideEntries(callpoint)" :key="entry.field.path" class="selector-editor__field">
          <PropertyValueForm
            v-if="entry.row !== undefined"
            :row="entry.row"
            panel="properties"
            :playhead="playhead"
            :disabled="disabled"
          />
          <p
            v-if="entry.row !== undefined && isOverrideEmpty(entry.row)"
            class="selector-editor__inherit"
            role="note"
          >
            继承通用（当前 ={{ genericValueText(entry.field) }}）
          </p>
          <button
            v-if="entry.row !== undefined && !isOverrideEmpty(entry.row)"
            type="button"
            class="selector-editor__clear"
            :aria-label="`清除 ${entry.field.path} 的覆盖值`"
            :disabled="disabled"
            @click="clearOverride(entry.field)"
          >
            清除
          </button>
          <p v-if="entry.row === undefined && entry.animated" class="selector-editor__animated" role="status">
            该行已打帧，在效果面板编辑
          </p>
          <p v-if="entry.row === undefined && !entry.animated" class="selector-editor__animated" role="status">
            该行未在目录行集合中派生
          </p>
        </div>

        <p v-if="animatedCount(callpoint) > 0" class="selector-editor__animated-note" role="status">
          {{ animatedCount(callpoint) }} 行已打帧，不在本面板编辑
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.selector-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
}

.selector-editor__generic {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.selector-editor__group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.selector-editor__group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}

.selector-editor__group-head:hover {
  border-color: var(--border-strong);
}

.selector-editor__group-caret {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.selector-editor__group-name {
  flex: 1 1 auto;
  text-align: left;
}

.selector-editor__group-count {
  color: var(--text-muted);
  font-size: 10px;
}

.selector-editor__group-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: 12px;
  min-width: 0;
}

.selector-editor__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.selector-editor__inherit {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.selector-editor__clear {
  align-self: flex-start;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: inherit;
  font-size: 10px;
  cursor: pointer;
}

.selector-editor__clear:disabled {
  opacity: 0.5;
  cursor: default;
}

.selector-editor__clear:not(:disabled):hover {
  border-color: var(--accent);
}

.selector-editor__animated {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.selector-editor__animated-note {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}
</style>
