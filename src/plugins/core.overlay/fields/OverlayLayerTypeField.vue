<script setup lang="ts">
/**
 * 层类型行（09-01）：`layer_type` 是结构开关，不是普通枚举。
 *
 * 切换前显示「将保留 / 将移除」清单；确认后一次 `commitBatch`，一次撤销回退整个字段面。
 * 按用户裁决：只删不加——只写 `layer_type` 与删除目标类型不适用的已知字段，不补任何缺省值。
 */
import { computed, ref } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import {
  declaredLayerType,
  effectiveLayerType,
  isOverlayLayerType,
  OVERLAY_LAYER_LABELS,
  OVERLAY_LAYER_TYPES,
  planLayerSwitch,
} from '../../../features/overlay/layers.ts'
import type { LayerSwitchPlan, OverlayLayerType } from '../../../features/overlay/layers.ts'
import { overlayBanners } from '../../../features/overlay/validation.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import OverlayGateBanner from '../components/OverlayGateBanner.vue'
import OverlayPresetPanel from '../components/OverlayPresetPanel.vue'
import { layerTypeSummary } from '../commit.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const documents = ctx.services.get(DOCUMENT_SERVICE)

const pending = ref<LayerSwitchPlan | null>(null)
const message = ref('')
const error = ref('')

const declared = computed(() => declaredLayerType(props.objects))
const effective = computed(() => effectiveLayerType(props.objects))
const selectedValue = computed({
  get: () => (declared.value !== null && isOverlayLayerType(declared.value) ? declared.value : effective.value),
  set: (value: OverlayLayerType) => requestSwitch(value),
})

const banners = computed(() => overlayBanners(props.objects))

const trackIndex = computed(() => {
  const view = documents?.view()
  if (view === null || view === undefined) return 0
  return view.tracks.findIndex((track) => track.clips.some((clip) => clip.clipKey === props.row.clipKey))
})

function requestSwitch(target: OverlayLayerType): void {
  message.value = ''
  error.value = ''
  const plan = planLayerSwitch(props.objects, target)
  if (!plan.writeLayerType && plan.remove.length === 0) {
    message.value = `已经是 ${OVERLAY_LAYER_LABELS[target]}，无需切换`
    return
  }
  pending.value = plan
}

function confirmSwitch(): void {
  const plan = pending.value
  if (plan === null) return
  const commands: DocCommand[] = []
  if (plan.writeLayerType) {
    commands.push({ kind: 'object.setValue', clipKey: props.row.clipKey, path: 'layer_type', value: plan.to })
  }
  for (const path of plan.remove) {
    commands.push({ kind: 'object.remove', clipKey: props.row.clipKey, path })
  }
  const outcome = ctx.commands.commitBatch(commands, `layer-switch:${props.row.clipKey}`)
  if (!outcome.ok) {
    error.value = outcome.error ?? '层类型切换失败'
    return
  }
  const removed = plan.remove.length
  message.value = `已切换到 ${OVERLAY_LAYER_LABELS[plan.to]}：保留 ${plan.keep.length} 项，移除 ${removed} 项；一次撤销可回退`
  pending.value = null
}

function cancel(): void {
  pending.value = null
  message.value = ''
  error.value = ''
}

function cleanDead(paths: string[]): void {
  const commands = paths.map((path): DocCommand => ({ kind: 'object.remove', clipKey: props.row.clipKey, path }))
  const outcome = ctx.commands.commitBatch(commands, `clean-dead:${props.row.clipKey}`)
  if (!outcome.ok) {
    error.value = outcome.error ?? '清理失败'
    return
  }
  message.value = `已清理 ${paths.length} 个当前层类型不读取的已知字段`
}
</script>

<template>
  <div class="overlay-layer">
    <div class="overlay-layer__control">
      <label>
        <span>层类型</span>
        <select v-model="selectedValue" :disabled="disabled">
          <option v-for="type in OVERLAY_LAYER_TYPES" :key="type" :value="type">
            {{ OVERLAY_LAYER_LABELS[type] }}（{{ type }}）
          </option>
        </select>
      </label>
      <span class="overlay-layer__summary">{{ layerTypeSummary(objects) }}</span>
      <OverlayPresetPanel
        :clip-key="row.clipKey"
        :objects="objects"
        track-type="OVERLAY"
        :duration="timing.duration"
        :groups="['fade', 'image', 'subtitle', 'layer']"
        :track-index="trackIndex"
        @done="message = $event"
      />
    </div>

    <p v-if="declared === null" class="overlay-layer__note">
      脚本没写 <code>layer_type</code>：校验器与运行时都按 fade 处理；首次编辑 fade 字段会补写显式值。
    </p>
    <p v-else-if="!isOverlayLayerType(declared)" class="overlay-layer__error">
      layer_type="{{ declared }}" 非法：运行时不建层；上面的选择可写入合法值。
    </p>

    <OverlayGateBanner track-type="OVERLAY" :objects="objects" @clean-dead="cleanDead" />

    <div v-if="pending !== null" class="overlay-layer__confirm" role="alertdialog" aria-label="层类型切换确认">
      <p class="overlay-layer__confirm-title">
        切换到 {{ OVERLAY_LAYER_LABELS[pending.to] }}：确认后一次提交、一次撤销回退。
      </p>
      <div class="overlay-layer__lists">
        <section>
          <strong>将保留（{{ pending.keep.length }}）</strong>
          <ul>
            <li v-for="path in pending.keep" :key="path">{{ path }}</li>
            <li v-if="pending.keep.length === 0" class="overlay-layer__none">无</li>
          </ul>
        </section>
        <section>
          <strong>将移除（{{ pending.remove.length }}）</strong>
          <ul>
            <li v-for="path in pending.remove" :key="path">{{ path }}</li>
            <li v-if="pending.remove.length === 0" class="overlay-layer__none">无</li>
          </ul>
        </section>
      </div>
      <p class="overlay-layer__note">只删不加：不补目标类型的缺省值；未知键不在移除清单内。</p>
      <div class="overlay-layer__buttons">
        <button type="button" @click="cancel">取消</button>
        <button type="button" class="overlay-layer__confirm-button" @click="confirmSwitch">确认切换</button>
      </div>
    </div>

    <p v-if="banners.length > 0" class="overlay-layer__hidden-note">
      死字段横幅见上；清理只删当前层类型不读取的已知字段，未知键保留。
    </p>
    <p v-if="message !== ''" class="overlay-layer__ok" role="status">{{ message }}</p>
    <p v-if="error !== ''" class="overlay-layer__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.overlay-layer {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.overlay-layer__control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.overlay-layer__control label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-layer__control select {
  padding: 2px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.overlay-layer__summary,
.overlay-layer__note,
.overlay-layer__hidden-note {
  color: var(--text-muted);
  font-size: 11px;
}

.overlay-layer__note,
.overlay-layer__error,
.overlay-layer__ok {
  margin: 0;
}

.overlay-layer__error {
  color: var(--error);
  font-size: 11px;
}

.overlay-layer__ok {
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-layer__confirm {
  padding: 6px;
  border: 1px solid var(--warning);
  border-radius: 4px;
  background: var(--bg-raised);
}

.overlay-layer__confirm-title {
  margin: 0 0 4px;
  color: var(--text);
  font-size: 12px;
}

.overlay-layer__lists {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}

.overlay-layer__lists strong {
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-layer__lists ul {
  margin: 2px 0 0;
  padding-left: 16px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.overlay-layer__none {
  color: var(--text-muted);
  list-style: none;
}

.overlay-layer__buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 5px;
}

.overlay-layer__buttons button {
  padding: 2px 9px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.overlay-layer__confirm-button {
  border-color: var(--accent) !important;
  background: var(--accent) !important;
  color: var(--bg-panel) !important;
}
</style>
