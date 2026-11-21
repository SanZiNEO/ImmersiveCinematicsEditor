<script setup lang="ts">
/**
 * 镜头呼吸卡片（正式 Editor）。
 *
 * 三个状态分开处理：
 * - 配置是否存在：不存在只给「添加」；添加写显式 `cam_breath_enabled=false` 并展开；
 * - 展开：卡片标题只控制折叠（父面板按片段保存），不动字段；
 * - 启用：标题旁开关只写 `cam_breath_enabled`；停用保留全部参数与展开状态。
 *
 * 参数行仍走统一 `row` 槽（外壳负责键帧 / 校验 / 撤销）；只有整卡操作直接提交命令：
 * 添加一次 `object.setValue`，移除一次 `compound`（逐条 `object.remove` 已存在的 `cam_breath_*`）。
 */
import { computed, ref } from 'vue'
import type { PropertyRow } from '../../../features/effects/types.ts'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { InspectorValueOptions } from '../../../features/effects/panels/inspectorValueOptions.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { isPresent, relabel, rowsByPath, staticValue } from './cameraInspector.ts'

const props = defineProps<{
  clipKey: string
  /** 呼吸 section 的完整 schema 行（父不装饰）。 */
  rows: readonly PropertyRow[]
  objects: JsonObject
  /** 父面板按片段保存的折叠状态；true = 收起。 */
  collapsed: boolean
}>()

const emit = defineEmits<{
  'set-expanded': [expanded: boolean]
}>()

defineSlots<{
  row: (slotProps: { row: PropertyRow; options: InspectorValueOptions; axis: boolean }) => unknown
}>()

const ctx = usePanelContext()

/** 呼吸字段全集（与目录 `TrackSchemas.cameraObjects()` 的 breath section 一致）。 */
const BREATH_PATHS = [
  'cam_breath_enabled',
  'cam_breath_type',
  'cam_breath_intensity',
  'cam_breath_speed',
  'cam_breath_seed',
  'cam_breath_trauma',
  'cam_breath_decay',
] as const

const byPath = computed(() => rowsByPath(props.rows))
const enabledRow = computed(() => byPath.value.get('cam_breath_enabled'))
const typeRow = computed(() => byPath.value.get('cam_breath_type'))
const intensityRow = computed(() => byPath.value.get('cam_breath_intensity'))
const speedRow = computed(() => byPath.value.get('cam_breath_speed'))
const seedRow = computed(() => byPath.value.get('cam_breath_seed'))
const traumaRow = computed(() => byPath.value.get('cam_breath_trauma'))
const decayRow = computed(() => byPath.value.get('cam_breath_decay'))

/** 配置是否存在只看片段里显式写出的键（不是 playback 的生效状态）。 */
const present = computed(() => BREATH_PATHS.some((path) => Object.prototype.hasOwnProperty.call(props.objects, path)))
const enabled = computed(() => staticValue(enabledRow.value) === true)
const breathType = computed(() => {
  const value = staticValue(typeRow.value)
  return typeof value === 'string' ? value : 'perlin'
})
const trauma = computed(() => breathType.value === 'trauma')
/** 已停用 / 换了形态时，既有冲击衰减参数仍要能找回（不清值）。 */
const retainedTrauma = computed(() => (
  !trauma.value && (isPresent(traumaRow.value) || isPresent(decayRow.value))
))

const plainOptions: InspectorValueOptions = {}
const typeOptions: InspectorValueOptions = {
  labels: {
    perlin: '平滑噪声',
    perlin_axis: '分轴噪声',
    sine: '正弦',
    trauma: '冲击衰减',
  },
}
const intensityOptions: InspectorValueOptions = { range: [0, 3, 0.01] }
const speedOptions: InspectorValueOptions = { range: [0, 4, 0.01] }
const traumaOptions: InspectorValueOptions = { range: [0, 1, 0.01] }

const error = ref('')

function commit(command: DocCommand): boolean {
  const outcome = ctx.commands.commit(command)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入失败'
    return false
  }
  error.value = ''
  return true
}

function add(): void {
  const wrote = commit({
    kind: 'object.setValue',
    clipKey: props.clipKey,
    path: 'cam_breath_enabled',
    value: false,
  })
  if (wrote) {
    emit('set-expanded', true)
  }
}

function toggleEnabled(): void {
  commit({
    kind: 'object.setValue',
    clipKey: props.clipKey,
    path: 'cam_breath_enabled',
    value: !enabled.value,
  })
}

function remove(): void {
  const removals: DocCommand[] = []
  for (const path of BREATH_PATHS) {
    if (Object.prototype.hasOwnProperty.call(props.objects, path)) {
      removals.push({ kind: 'object.remove', clipKey: props.clipKey, path })
    }
  }
  if (removals.length === 0) {
    return
  }
  const wrote = commit({ kind: 'compound', commands: removals })
  if (wrote) {
    emit('set-expanded', false)
  }
}
</script>

<template>
  <section class="breath-card" :data-enabled="present ? String(enabled) : ''" aria-label="镜头呼吸">
    <header class="breath-card__head">
      <template v-if="!present">
        <span class="breath-card__title">镜头呼吸</span>
        <button type="button" class="breath-card__button" aria-label="添加镜头呼吸" @click="add">
          添加
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="breath-card__title breath-card__title--toggle"
          :aria-expanded="!collapsed"
          aria-controls="breath-parameters"
          @click="emit('set-expanded', !collapsed)"
        >
          <span aria-hidden="true">{{ collapsed ? '▸' : '▾' }}</span>
          镜头呼吸
        </button>
        <button
          type="button"
          class="breath-card__button breath-card__toggle"
          :class="{ 'breath-card__toggle--on': enabled }"
          :aria-pressed="enabled"
          :aria-label="enabled ? '停用镜头呼吸' : '启用镜头呼吸'"
          @click="toggleEnabled"
        >
          {{ enabled ? '已启用' : '已停用' }}
        </button>
      </template>
    </header>

    <div v-if="present && !collapsed" id="breath-parameters" class="breath-card__body">
      <slot
        v-if="typeRow"
        name="row"
        :row="relabel(typeRow, '运动形态')"
        :options="typeOptions"
        :axis="false"
      />
      <div class="breath-axis">
        <div v-if="intensityRow" class="breath-axis__cell">
          <slot name="row" :row="relabel(intensityRow, '强度')" :options="intensityOptions" :axis="true" />
        </div>
        <div v-if="speedRow" class="breath-axis__cell">
          <slot name="row" :row="relabel(speedRow, '速度')" :options="speedOptions" :axis="true" />
        </div>
        <div v-if="seedRow" class="breath-axis__cell">
          <slot name="row" :row="relabel(seedRow, '种子')" :options="plainOptions" :axis="true" />
        </div>
      </div>

      <template v-if="trauma">
        <div class="breath-axis">
          <div v-if="traumaRow" class="breath-axis__cell">
            <slot name="row" :row="relabel(traumaRow, '初始冲击')" :options="traumaOptions" :axis="true" />
          </div>
          <div v-if="decayRow" class="breath-axis__cell">
            <slot name="row" :row="relabel(decayRow, '衰减速度')" :options="plainOptions" :axis="true" />
          </div>
        </div>
      </template>
      <details v-else-if="retainedTrauma" class="breath-fold">
        <summary>冲击衰减参数（已保留，当前形态不读取）</summary>
        <div class="breath-axis">
          <div v-if="traumaRow" class="breath-axis__cell">
            <slot name="row" :row="relabel(traumaRow, '初始冲击')" :options="traumaOptions" :axis="true" />
          </div>
          <div v-if="decayRow" class="breath-axis__cell">
            <slot name="row" :row="relabel(decayRow, '衰减速度')" :options="plainOptions" :axis="true" />
          </div>
        </div>
        <p class="breath-note">只有运动形态为冲击衰减时读取；切回该形态即可继续使用。</p>
      </details>

      <div class="breath-card__footer">
        <button type="button" class="breath-card__remove" @click="remove">移除镜头呼吸</button>
        <span class="breath-note">删除本片段的呼吸配置字段；一次撤销可回退。</span>
      </div>
    </div>

    <p v-if="error !== ''" class="breath-warning" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.breath-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-raised);
}

.breath-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.breath-card__title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
}

.breath-card__title--toggle {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.breath-card__button {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.breath-card__button:hover {
  background: var(--bg-hover);
}

.breath-card__toggle--on {
  border-color: var(--accent);
  color: var(--accent);
}

.breath-card__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.breath-axis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 6px;
  min-width: 0;
}

.breath-axis__cell {
  min-width: 0;
}

.breath-fold {
  margin: 2px 0 0;
  padding: 2px 0;
  border-top: 1px dashed var(--border);
}

.breath-fold > summary {
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.breath-card__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

.breath-card__remove {
  padding: 1px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--warning);
  font-size: 11px;
  cursor: pointer;
}

.breath-card__remove:hover {
  background: var(--bg-hover);
}

.breath-note {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.breath-warning {
  margin: 0;
  color: var(--warning);
  font-size: 11px;
  line-height: 1.45;
}
</style>
