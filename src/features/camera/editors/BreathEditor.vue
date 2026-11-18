<script setup lang="ts">
/**
 * 手持呼吸编辑器（08-01 §三）：7 个静态字段（全部 `mode=value`，不可打帧）。
 *
 * 规则：
 * - `cam_breath_enabled` 是总开关；关掉后其余 6 行折叠但值保留，重新打开回到上一组值
 *   （仅可见性变化，不写文档、不清值）；
 * - `trauma` 与 `type=trauma` 的关系只在行内提示：任何情况下都不自动改 type，也不清空 trauma 值；
 * - 本 section 没有效果面板入口，不显示"已打帧"提示。
 */
import { computed } from 'vue'
import { BREATH_PATHS, type CameraEditorInput } from '../fieldSurface.ts'
import type { PropertyRow } from '../../effects/types.ts'
import PropertyValueForm from '../../effects/panels/PropertyValueForm.vue'
import { rowAt, staticString } from './editorRows.ts'

const props = defineProps<CameraEditorInput>()

/** 总开关之外的参数路径（目录顺序；trauma 单独留出挂提示）。 */
const BEFORE_TRAUMA_PATHS: readonly string[] = [
  BREATH_PATHS.intensity,
  BREATH_PATHS.seed,
  BREATH_PATHS.type,
  BREATH_PATHS.speed,
]

const enabledRow = computed(() => rowAt(props.rows, BREATH_PATHS.enabled))

/** 开关状态：显式静态值 > 目录缺省。 */
const enabled = computed(() => {
  const row = enabledRow.value
  if (row === undefined) {
    return false
  }
  if (row.hasValue) {
    return row.value === true
  }
  return row.defaultValue === true
})

const beforeTraumaRows = computed<PropertyRow[]>(() =>
  BEFORE_TRAUMA_PATHS
    .map((path) => rowAt(props.rows, path))
    .filter((row): row is PropertyRow => row !== undefined),
)

const traumaRow = computed(() => rowAt(props.rows, BREATH_PATHS.trauma))
const decayRow = computed(() => rowAt(props.rows, BREATH_PATHS.decay))

const typeRow = computed(() => rowAt(props.rows, BREATH_PATHS.type))
const fallbackType = computed(() =>
  typeof typeRow.value?.defaultValue === 'string' ? typeRow.value.defaultValue : 'perlin',
)

/** 当前呼吸类型（行值 > 目录缺省 > perlin）。 */
const breathType = computed(() => staticString(props.objects, BREATH_PATHS.type, fallbackType.value))

/** trauma 值是否已被作者显式设置（未设置不提示残留）。 */
const traumaSet = computed(() => traumaRow.value?.hasValue === true)

/** trauma 行内提示：只说明生效条件，不自动改类型、不清值。 */
const traumaHint = computed(() => {
  if (breathType.value === 'trauma') {
    return 'trauma 模式使用 cam_breath_trauma 作为强度'
  }
  if (traumaSet.value) {
    return '该值只在 type=trauma 时生效'
  }
  return ''
})
</script>

<template>
  <div class="breath-editor">
    <PropertyValueForm
      v-if="enabledRow !== undefined"
      :row="enabledRow"
      panel="properties"
      :playhead="playhead"
      :disabled="disabled"
    />

    <div v-if="enabled" class="breath-editor__rest">
      <PropertyValueForm
        v-for="row in beforeTraumaRows"
        :key="row.path"
        :row="row"
        panel="properties"
        :playhead="playhead"
        :disabled="disabled"
      />

      <template v-if="traumaRow !== undefined">
        <PropertyValueForm
          :row="traumaRow"
          panel="properties"
          :playhead="playhead"
          :disabled="disabled"
        />
        <p v-if="traumaHint !== ''" class="breath-editor__hint" role="note">{{ traumaHint }}</p>
      </template>

      <PropertyValueForm
        v-if="decayRow !== undefined"
        :row="decayRow"
        panel="properties"
        :playhead="playhead"
        :disabled="disabled"
      />
    </div>

    <p v-else class="breath-editor__folded" role="status">
      已关闭手持呼吸：其余 6 项参数已保留，重新打开后恢复。
    </p>
  </div>
</template>

<style scoped>
.breath-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
}

.breath-editor__rest {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.breath-editor__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.breath-editor__folded {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}
</style>
