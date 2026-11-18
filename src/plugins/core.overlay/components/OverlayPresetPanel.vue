<script setup lang="ts">
/**
 * 便利预设面板（09-08）。
 *
 * 流程：选预设 → 选「应用到当前片段 / 新建片段」→ 看字段级差异（新增 / 修改 / 删除 /
 * 关键帧四类）→ 确认 → 一次 `commitBatch`。预设本身不序列化。
 */
import { computed, ref, watch } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { OverlayLayerType } from '../../../features/overlay/layers.ts'
import {
  planPresetApplication,
  planPresetCreation,
  presetsFor,
} from '../../../features/overlay/presets.ts'
import type { OverlayPreset, PresetDiff, PresetGroup } from '../../../features/overlay/presets.ts'
import type { PresetPlan } from '../../../features/overlay/presets.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'

const props = defineProps<{
  clipKey: string
  objects: JsonObject
  trackType: 'OVERLAY' | 'LETTERBOX'
  layerType?: OverlayLayerType
  duration: number
  groups: PresetGroup[]
  /** 当前轨道索引（新建片段默认目标）。 */
  trackIndex: number
}>()

const emit = defineEmits<{
  done: [message: string]
}>()

const ctx = usePanelContext()
const catalog = ctx.services.get(CATALOG_SERVICE)
const documents = ctx.services.get(DOCUMENT_SERVICE)

const open = ref(false)
const selectedId = ref<string | null>(null)
const mode = ref<'apply' | 'new'>('apply')
const newTrackIndex = ref<number>(-1)
const newStart = ref(0)
const newDuration = ref(3)
const message = ref('')
const error = ref('')

const presets = computed<OverlayPreset[]>(() => {
  const list: OverlayPreset[] = []
  for (const group of props.groups) {
    const byGroup = props.trackType === 'OVERLAY' && group !== 'layer'
      ? presetsFor(group, props.trackType, props.layerType)
      : presetsFor(group, props.trackType)
    for (const preset of byGroup) {
      if (!list.some((item) => item.id === preset.id)) {
        list.push(preset)
      }
    }
  }
  return list
})

const selected = computed<OverlayPreset | null>(() => {
  if (selectedId.value === null) return null
  return presets.value.find((preset) => preset.id === selectedId.value) ?? null
})

watch(selected, (preset) => {
  if (preset !== null) {
    mode.value = preset.mode === 'new' ? 'new' : 'apply'
  }
})

const trackOptions = computed(() => {
  const view = documents?.view()
  if (view === null || view === undefined) {
    return []
  }
  return view.tracks
    .map((track, index) => ({ track, index }))
    .filter((entry) => entry.track.type === props.trackType)
})

const currentPlan = computed<PresetPlan | null>(() => {
  const preset = selected.value
  if (preset === null) {
    return null
  }
  if (catalog === undefined) {
    return null
  }
  if (mode.value === 'apply') {
    return planPresetApplication({
      preset,
      clipKey: props.clipKey,
      objects: props.objects,
      duration: props.duration,
      catalog,
    })
  }
  return planPresetCreation({
    preset,
    trackIndex: newTrackIndex.value,
    startTime: newStart.value,
    duration: newDuration.value,
    catalog,
  })
})

const canApply = computed(() => {
  const plan = currentPlan.value
  return plan !== null && plan.blockers.length === 0 && plan.commands.length > 0
})

const diffSections = computed<Array<{ key: keyof PresetDiff; label: string; items: string[] }>>(() => {
  const plan = currentPlan.value
  if (plan === null) return []
  const diff = plan.diff
  return [
    {
      key: 'added',
      label: '新增',
      items: diff.added.map((item) => `${item.path} = ${short(item.value)}`),
    },
    {
      key: 'modified',
      label: '修改',
      items: diff.modified.map((item) => `${item.path}: ${short(item.before)} → ${short(item.after)}`),
    },
    {
      key: 'removed',
      label: '删除',
      items: diff.removed.map((item) => `${item.path}（原 ${short(item.before)}）`),
    },
    {
      key: 'keyframes',
      label: '关键帧',
      items: diff.keyframes.map((item) =>
        `${item.path} · ${item.action === 'add' ? '新增' : '替换'} ${item.frames.length} 帧（原 ${item.beforeCount} 帧）：${item.frames.map((frame) => `${frame.time}s=${short(frame.value)}`).join('，')}`),
    },
  ]
})

function short(value: unknown): string {
  if (value === undefined) return '未设置'
  const text = JSON.stringify(value)
  return text === undefined ? String(value) : (text.length > 60 ? `${text.slice(0, 57)}…` : text)
}

function openPanel(): void {
  open.value = true
  message.value = ''
  error.value = ''
  if (selectedId.value === null && presets.value[0] !== undefined) {
    selectedId.value = presets.value[0].id
  }
  if (newTrackIndex.value < 0) {
    newTrackIndex.value = props.trackIndex
  }
  newStart.value = documents?.sessionView().playhead ?? 0
}

function close(): void {
  open.value = false
}

function apply(): void {
  const plan = currentPlan.value
  if (plan === null) {
    error.value = '没有可应用的预设'
    return
  }
  if (plan.blockers.length > 0) {
    error.value = plan.blockers.join('；')
    return
  }
  if (plan.commands.length === 0) {
    message.value = '没有需要写入的字段'
    return
  }
  const outcome = ctx.commands.commitBatch(plan.commands)
  if (!outcome.ok) {
    error.value = outcome.error ?? '提交失败'
    return
  }
  error.value = ''
  message.value = `已应用「${selected.value?.name ?? ''}」：新增 ${plan.diff.added.length}、修改 ${plan.diff.modified.length}、删除 ${plan.diff.removed.length}、关键帧 ${plan.diff.keyframes.length} 组`
  emit('done', message.value)
  open.value = false
}
</script>

<template>
  <div class="overlay-presets">
    <button type="button" class="overlay-presets__open" @click="openPanel">
      便利预设（{{ presets.length }}）
    </button>

    <div v-if="open" class="overlay-presets__backdrop" role="dialog" aria-modal="true" aria-label="便利预设">
      <section class="overlay-presets__dialog">
        <header class="overlay-presets__header">
          <h4>便利预设</h4>
          <button type="button" class="overlay-presets__close" aria-label="关闭" @click="close">×</button>
        </header>

        <div class="overlay-presets__body">
          <aside class="overlay-presets__list">
            <button
              v-for="preset in presets"
              :key="preset.id"
              type="button"
              class="overlay-presets__item"
              :class="{ 'overlay-presets__item--active': preset.id === selectedId }"
              :title="preset.description"
              @click="selectedId = preset.id; message = ''; error = ''"
            >
              <span>{{ preset.name }}</span>
              <small>{{ preset.id }}</small>
            </button>
            <p v-if="presets.length === 0" class="overlay-presets__empty">当前层类型没有可用预设。</p>
          </aside>

          <div class="overlay-presets__detail">
            <p v-if="selected === null" class="overlay-presets__empty">选择左侧预设查看差异。</p>
            <template v-else>
              <p class="overlay-presets__desc">{{ selected.description }}</p>

              <div class="overlay-presets__mode">
                <label>
                  <input v-model="mode" type="radio" value="apply" :disabled="selected.mode === 'new'">
                  应用到当前片段
                </label>
                <label>
                  <input v-model="mode" type="radio" value="new" :disabled="selected.mode === 'apply'">
                  新建片段
                </label>
              </div>

              <div v-if="mode === 'new'" class="overlay-presets__new">
                <label>
                  目标轨道
                  <select v-model.number="newTrackIndex">
                    <option v-for="entry in trackOptions" :key="entry.track.trackId" :value="entry.index">
                      {{ entry.track.name || entry.track.type }}（#{{ entry.index }}）
                    </option>
                  </select>
                </label>
                <label>
                  开始（秒）
                  <input v-model.number="newStart" type="number" min="0" step="0.1">
                </label>
                <label>
                  时长（秒）
                  <input v-model.number="newDuration" type="number" min="0.1" step="0.1">
                </label>
              </div>

              <div class="overlay-presets__diff">
                <h5>字段级差异</h5>
                <section v-for="section in diffSections" :key="section.key">
                  <strong>{{ section.label }}（{{ section.items.length }}）</strong>
                  <ul>
                    <li v-for="item in section.items" :key="item">{{ item }}</li>
                    <li v-if="section.items.length === 0" class="overlay-presets__none">无</li>
                  </ul>
                </section>
                <p v-if="currentPlan?.diff.layerSwitch" class="overlay-presets__note">
                  先做层类型转换：{{ currentPlan.diff.layerSwitch.from }} → {{ currentPlan.diff.layerSwitch.to }}
                </p>
                <p v-for="note in currentPlan?.diff.notes ?? []" :key="note" class="overlay-presets__note">{{ note }}</p>
              </div>

              <ul v-if="currentPlan?.blockers.length" class="overlay-presets__blockers">
                <li v-for="blocker in currentPlan.blockers" :key="blocker">{{ blocker }}</li>
              </ul>

              <p v-if="message !== ''" class="overlay-presets__ok" role="status">{{ message }}</p>
              <p v-if="error !== ''" class="overlay-presets__error" role="alert">{{ error }}</p>

              <footer class="overlay-presets__footer">
                <button type="button" class="overlay-presets__cancel" @click="close">取消</button>
                <button type="button" class="overlay-presets__apply" :disabled="!canApply" @click="apply">
                  应用（一次提交 / 一次撤销）
                </button>
              </footer>
            </template>
          </div>
        </div>
        <footer class="overlay-presets__hint">
          共 {{ presets.length }} 个预设；不写素材路径、不写视图状态、不碰相机 / 过渡 / 调色字段。
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.overlay-presets__open {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.overlay-presets__open:hover {
  background: var(--bg-hover);
}

.overlay-presets__backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg-app) 72%, transparent);
}

.overlay-presets__dialog {
  display: flex;
  flex-direction: column;
  width: min(760px, 92vw);
  max-height: 84vh;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-panel);
  box-shadow: 0 10px 30px color-mix(in srgb, var(--text) 22%, transparent);
}

.overlay-presets__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.overlay-presets__header h4 {
  margin: 0;
  color: var(--text);
  font-size: 13px;
}

.overlay-presets__close {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
}

.overlay-presets__body {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.overlay-presets__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  overflow: auto;
  border-right: 1px solid var(--border);
}

.overlay-presets__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.overlay-presets__item small {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.overlay-presets__item--active {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.overlay-presets__detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  overflow: auto;
}

.overlay-presets__desc {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.overlay-presets__mode {
  display: flex;
  gap: 14px;
  color: var(--text);
  font-size: 12px;
}

.overlay-presets__new {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 11px;
}

.overlay-presets__new label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-secondary);
}

.overlay-presets__new input,
.overlay-presets__new select {
  width: 110px;
  padding: 2px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.overlay-presets__diff h5 {
  margin: 0 0 4px;
  color: var(--text);
  font-size: 12px;
}

.overlay-presets__diff section {
  margin-bottom: 5px;
}

.overlay-presets__diff strong {
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-presets__diff ul {
  margin: 2px 0 0;
  padding-left: 18px;
  color: var(--text);
  font-size: 11px;
}

.overlay-presets__none {
  color: var(--text-muted);
  list-style: none;
}

.overlay-presets__note {
  margin: 2px 0;
  color: var(--text-muted);
  font-size: 11px;
}

.overlay-presets__blockers {
  margin: 0;
  padding: 4px 6px 4px 20px;
  border: 1px solid var(--error);
  border-radius: 3px;
  color: var(--error);
  font-size: 11px;
}

.overlay-presets__ok {
  margin: 0;
  color: var(--success, var(--accent));
  font-size: 12px;
}

.overlay-presets__error {
  margin: 0;
  color: var(--error);
  font-size: 12px;
}

.overlay-presets__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.overlay-presets__cancel,
.overlay-presets__apply {
  padding: 3px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
}

.overlay-presets__cancel {
  background: transparent;
  color: var(--text);
}

.overlay-presets__apply {
  background: var(--accent);
  color: var(--bg-panel);
}

.overlay-presets__apply:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.overlay-presets__hint {
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 10px;
}
</style>
