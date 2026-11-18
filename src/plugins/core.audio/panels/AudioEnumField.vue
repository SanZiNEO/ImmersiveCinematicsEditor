<script setup lang="ts">
/**
 * AUDIO 枚举字段（source / category / position_mode / attenuation）：
 * 在下拉旁给出运行时口径提示；切换 source 时保留 sound 并提示“需要重新选择”。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { audioCategoryNotice } from '../shared/audioSpec.ts'
import { commitStaticValue, currentValueOf } from '../shared/fieldOps.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const error = ref('')
const notice = ref('')

const current = computed(() => {
  const raw = currentValueOf(props.row, props.objects)
  return typeof raw === 'string' ? raw : ''
})

const source = computed(() => {
  const raw = props.objects.source
  if (typeof raw === 'object' && raw !== null) {
    const value = (raw as Record<string, JsonValue>).value
    if (typeof value === 'string') return value
  }
  return 'file'
})
const category = computed(() => {
  const raw = props.objects.category
  if (typeof raw === 'object' && raw !== null) {
    const value = (raw as Record<string, JsonValue>).value
    if (typeof value === 'string') return value
  }
  return 'music'
})
const positionMode = computed(() => {
  const raw = props.objects.position_mode
  if (typeof raw === 'object' && raw !== null) {
    const value = (raw as Record<string, JsonValue>).value
    if (typeof value === 'string') return value
  }
  return 'relative'
})
const attenuation = computed(() => {
  const raw = props.objects.attenuation
  if (typeof raw === 'object' && raw !== null) {
    const value = (raw as Record<string, JsonValue>).value
    if (typeof value === 'string') return value
  }
  return 'linear'
})

const hint = computed(() => {
  switch (props.row.path) {
    case 'source':
      return source.value === 'minecraft'
        ? 'minecraft：从原版声音注册表读 OGG（sound 填 minecraft:music.game 这类 id）。'
        : 'file：从 resource/ 读文件（sound 填相对路径，扩展名受运行时白名单限制）。'
    case 'category':
      return category.value === 'music'
        ? 'music：相对玩家、无衰减、不受监听点影响。'
        : 'ambient：按 position_mode 定位；监听点可能是相机。'
    case 'position_mode':
      return positionMode.value === 'absolute'
        ? 'absolute：x/y/z 是世界坐标，不是相对监听点。'
        : 'relative：x/y/z 相对监听点（music 固定相对玩家）。'
    case 'attenuation':
      return attenuation.value === 'none'
        ? 'none：不按距离衰减（仍按位置播放）。'
        : 'linear：按与监听点的距离线性衰减。'
    default:
      return ''
  }
})

const crossNotice = computed(() => {
  if (!(props.row.path === 'category' || props.row.path === 'position_mode' || props.row.path === 'attenuation')) {
    return null
  }
  return audioCategoryNotice({ category: category.value, positionMode: positionMode.value, attenuation: attenuation.value })
})

function onChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  const next = target.value
  const previous = current.value
  // source 是语义开关：切换前明确告知 sound 会保留，但需要重新选择匹配的音源。
  if (props.row.path === 'source' && next !== previous) {
    const sound = props.objects.sound
    const soundValue = typeof sound === 'object' && sound !== null
      ? (sound as Record<string, JsonValue>).value
      : undefined
    const hasSound = typeof soundValue === 'string' && soundValue.trim() !== ''
    if (hasSound && !window.confirm('切换 source 会保留现有 sound 文本，但它可能不再匹配新的取值域。继续？')) {
      target.value = previous
      return
    }
  }
  const outcome = commitStaticValue(ctx.commands, props.row, next as JsonValue)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    target.value = previous
    return
  }
  error.value = ''
  if (props.row.path === 'source') {
    notice.value = `已切换 source=${next}；sound 文本保留不变，需要重新选择匹配的音源（一次撤销可回到 ${previous}）。`
  } else {
    notice.value = `已设置为 ${next}。`
  }
}

const options = computed(() => props.row.enumValues ?? [])

/** 显示中文语义，option 的 value 仍是脚本原始枚举。 */
function optionLabel(item: string): string {
  if (props.row.path === 'source') {
    return item === 'minecraft' ? '声音注册表 (minecraft)' : '资源文件 (file)'
  }
  if (props.row.path === 'category') {
    return item === 'ambient' ? '环境音 (ambient)' : '背景音乐 (music)'
  }
  if (props.row.path === 'position_mode') {
    return item === 'absolute' ? '世界坐标 (absolute)' : '听者偏移 (relative)'
  }
  if (props.row.path === 'attenuation') {
    return item === 'none' ? '无衰减 (none)' : '线性衰减 (linear)'
  }
  return item
}

/** 10-01：music 时 position_mode / attenuation 值保留但不参与定位。 */
const inactiveByMusic = computed(() => {
  if (props.row.path !== 'position_mode' && props.row.path !== 'attenuation') return false
  return category.value === 'music'
})
</script>

<template>
  <div class="wf-enum" :data-path="row.path">
    <select
      class="wf-enum__select"
      :value="current"
      :disabled="disabled || inactiveByMusic"
      :aria-label="row.label"
      @change="onChange"
    >
      <option v-for="item in options" :key="item" :value="item">{{ optionLabel(item) }}</option>
    </select>
    <p v-if="hint !== ''" class="wf-enum__hint">{{ hint }}</p>
    <p v-if="inactiveByMusic" class="wf-enum__hint">category=music：固定相对玩家、无衰减；该设置值保留但不参与定位（切回 ambient 后可编辑）。</p>
    <p v-if="crossNotice !== null" class="wf-enum__warn">{{ crossNotice }}</p>
    <p v-if="notice !== ''" class="wf-enum__notice" role="status">{{ notice }}</p>
    <p v-if="error !== ''" class="wf-enum__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-enum {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 0;
}

.wf-enum__select {
  box-sizing: border-box;
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.wf-enum__select:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.wf-enum__hint,
.wf-enum__warn,
.wf-enum__notice,
.wf-enum__error {
  margin: 0;
  font-size: 10px;
}

.wf-enum__hint {
  color: var(--text-muted);
}

.wf-enum__warn {
  color: var(--warning);
}

.wf-enum__notice {
  color: var(--text-secondary);
}

.wf-enum__error {
  color: var(--error);
}
</style>
