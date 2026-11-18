<script setup lang="ts">
/**
 * LUT 路径字段（10-07）：相对资源根、只认 .cube（大小写不敏感）；
 * “浏览”把资源抽屉的填充目标设为本字段；存在性只看资源清单，不读文件内容。
 */
import { computed, onMounted, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { RESOURCE_SERVICE } from '../../../workbench/api/tokens.ts'
import type { MediaResourceServicePort } from '../../../workbench/api/resources.ts'
import { checkCubePath } from '../shared/colorSpec.ts'
import { commitStaticValue, currentValueOf } from '../shared/fieldOps.ts'
import { setResourceFillTarget } from '../shared/resourceTarget.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const service = ctx.services.get(RESOURCE_SERVICE) as MediaResourceServicePort | null

const value = computed(() => {
  const raw = currentValueOf(props.row, props.objects)
  return typeof raw === 'string' ? raw : ''
})

const error = ref('')
const listingAvailable = ref(false)
const listingMessage = ref('')
const files = ref<string[] | null>(null)
const loading = ref(false)

async function refresh(): Promise<void> {
  if (service === null || service === undefined) {
    listingAvailable.value = false
    listingMessage.value = '资源服务未提供：未连接游戏实例时无法列举 resource/'
    return
  }
  loading.value = true
  listingMessage.value = ''
  try {
    const result = await service.list('all' as never)
    if (result.kind === 'lang' || !('files' in result)) {
      listingAvailable.value = false
      listingMessage.value = 'resource.list 回执不是文件列表'
      return
    }
    files.value = result.files.map((file) => file.replace(/\\/g, '/').toLowerCase())
    listingAvailable.value = true
    listingMessage.value = result.truncated ? '资源清单已截断：未命中只提示，不据此判缺失。' : ''
  } catch (cause) {
    listingAvailable.value = false
    listingMessage.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (value.value !== '') void refresh()
})

const pathCheck = computed(() => checkCubePath(value.value))

const presence = computed<'idle' | 'present' | 'missing' | 'unknown'>(() => {
  if (value.value === '') return 'idle'
  if (!listingAvailable.value || files.value === null) return 'unknown'
  const normalized = value.value.trim().replace(/\\/g, '/').toLowerCase()
  return files.value.includes(normalized) ? 'present' : 'missing'
})

function commit(next: string): void {
  if (props.disabled) return
  const check = checkCubePath(next)
  if (next.trim() !== '' && !check.ok) {
    error.value = check.messages[0] ?? 'LUT 路径不合法，未写入'
    return
  }
  const outcome = commitStaticValue(ctx.commands, props.row, next as JsonValue)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return
  }
  error.value = ''
  void refresh()
}

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement
  const before = value.value
  commit(target.value)
  // 非法路径或写入被拒绝时把输入框还原为文档中的合法值，避免视觉上假成功。
  if (error.value !== '') target.value = before
}

function browse(): void {
  if (props.disabled) return
  setResourceFillTarget({
    clipKey: props.row.clipKey,
    trackType: props.row.def?.scope[0] ?? 'ADJUST',
    path: props.row.path,
    kind: 'lut',
    current: value.value,
  })
  ctx.requestOpenDrawer('resources')
}
</script>

<template>
  <div class="wf-lut" :data-path="row.path">
    <div class="wf-lut__line">
      <input
        class="wf-lut__input"
        type="text"
        :value="value"
        :disabled="disabled"
        placeholder="相对 resource/ 的 .cube 路径"
        :aria-label="row.label"
        @change="onInput"
      >
      <button type="button" class="wf-lut__button" :disabled="disabled" @click="browse">浏览</button>
      <button type="button" class="wf-lut__button" :disabled="disabled || loading" @click="refresh">
        {{ loading ? '列举中…' : '刷新' }}
      </button>
    </div>
    <p v-if="!pathCheck.ok" class="wf-lut__warn">{{ pathCheck.messages[0] }}</p>
    <p v-else-if="presence === 'present'" class="wf-lut__ok">资源列表命中</p>
    <p v-else-if="presence === 'missing'" class="wf-lut__warn">
      资源列表未找到（{{ listingMessage || '路径保留，不据此判缺失' }}）
    </p>
    <p v-else-if="presence === 'unknown'" class="wf-lut__hint">资源列表不可用，未核对存在性（不判缺失）。</p>
    <p v-else class="wf-lut__hint">只接受 .cube（大小写不敏感）；路径相对资源根，不能是本地绝对路径。</p>
    <p v-if="error !== ''" class="wf-lut__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-lut {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 0;
}

.wf-lut__line {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.wf-lut__input {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.wf-lut__button {
  flex: 0 0 auto;
  padding: 1px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.wf-lut__button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.wf-lut__warn,
.wf-lut__ok,
.wf-lut__error,
.wf-lut__hint {
  margin: 0;
  font-size: 10px;
}

.wf-lut__warn,
.wf-lut__error {
  color: var(--error);
}

.wf-lut__ok {
  color: var(--success, var(--text-secondary));
}

.wf-lut__hint {
  color: var(--text-muted);
}
</style>
