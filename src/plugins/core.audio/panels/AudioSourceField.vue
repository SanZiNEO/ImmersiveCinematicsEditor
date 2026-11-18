<script setup lang="ts">
/**
 * AUDIO `sound` 字段（10-01 §三）：
 * - 文本 + “浏览资源”；
 * - source=minecraft 时按 registry 声音 id 校验，source=file 时按扩展名/相对路径/资源清单校验；
 * - 点“浏览”把资源抽屉的填充目标设为本字段，并打开 `resources` 抽屉。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { RESOURCE_SERVICE } from '../../../workbench/api/tokens.ts'
import type { MediaResourceServicePort } from '../../../workbench/api/resources.ts'
import { AUDIO_FILE_EXTS, checkAudioSound } from '../shared/audioSpec.ts'
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
const service = ctx.services.get(RESOURCE_SERVICE) as
  | (MediaResourceServicePort & { queryRegistry?: (kind: string, query: string, limit?: number) => Promise<string[]> })
  | null

const value = computed(() => {
  const raw = currentValueOf(props.row, props.objects)
  return typeof raw === 'string' ? raw : ''
})
const source = computed(() => {
  const raw = props.objects.source
  if (typeof raw === 'object' && raw !== null) {
    const explicit = (raw as Record<string, JsonValue>).value
    if (typeof explicit === 'string') return explicit
  }
  return 'file'
})

const error = ref('')
const available = ref(false)
const resourceFiles = ref<ReadonlySet<string> | null>(null)
const registrySounds = ref<ReadonlySet<string> | null>(null)
const registryOptions = ref<string[]>([])
const inputRef = ref<HTMLInputElement | null>(null)
const probing = ref(false)

async function probeAudio(): Promise<void> {
  if (service === null || service === undefined) return
  probing.value = true
  try {
    const listing = await service.list('audio' as never)
    if (listing.kind === 'lang' || !('files' in listing)) {
      available.value = false
      resourceFiles.value = null
    } else {
      available.value = true
      resourceFiles.value = new Set(listing.files.map((file) => file.replace(/\\/g, '/').toLowerCase()))
    }
  } catch {
    available.value = false
    resourceFiles.value = null
  } finally {
    probing.value = false
  }
}

async function probeRegistry(query = value.value): Promise<void> {
  if (service === null || service === undefined || service.queryRegistry === undefined) return
  probing.value = true
  try {
    const matches = await service.queryRegistry('sound', query, 80)
    registrySounds.value = new Set(matches.map((item) => item.toLowerCase()))
    registryOptions.value = matches
    available.value = true
  } catch {
    registrySounds.value = null
    registryOptions.value = []
    available.value = false
  } finally {
    probing.value = false
  }
}

onMounted(() => {
  if (source.value === 'minecraft') void probeRegistry('')
  else void probeAudio()
})

watch(source, (next) => {
  registrySounds.value = null
  registryOptions.value = []
  resourceFiles.value = null
  if (next === 'minecraft') void probeRegistry('')
  else void probeAudio()
})

const check = computed(() => checkAudioSound({
  sound: value.value,
  source: source.value,
  resources: resourceFiles.value,
  registry: registrySounds.value,
}))

const level = computed(() => {
  if (check.value.level === 'error') return 'error'
  if (check.value.messages.length > 0) return 'warning'
  return 'ok'
})

function commit(next: string): void {
  if (props.disabled) return
  const outcome = commitStaticValue(ctx.commands, props.row, next as JsonValue)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return
  }
  error.value = ''
}

function onInput(event: Event): void {
  commit((event.target as HTMLInputElement).value)
}

function browse(): void {
  if (source.value === 'minecraft') {
    // 10-01：minecraft 走声音注册表搜索，不把 resource/ 文件选进这个字段。
    void probeRegistry('').then(() => {
      void nextTick(() => inputRef.value?.focus())
    })
    return
  }
  setResourceFillTarget({
    clipKey: props.row.clipKey,
    trackType: props.row.def?.scope[0] ?? 'AUDIO',
    path: props.row.path,
    kind: 'audio',
    current: value.value,
  })
  ctx.requestOpenDrawer('resources')
}
</script>

<template>
  <div class="wf-source" :data-path="row.path">
    <div class="wf-source__line">
      <input
        ref="inputRef"
        class="wf-source__input"
        type="text"
        :value="value"
        :disabled="disabled"
        :list="source === 'minecraft' ? 'wf-audio-registry-options' : undefined"
        :placeholder="source === 'minecraft' ? 'minecraft:music.game' : `相对 resource/ 的音频路径（${AUDIO_FILE_EXTS.join('/')}）`"
        :aria-label="row.label"
        @change="onInput"
      >
      <datalist v-if="source === 'minecraft'" id="wf-audio-registry-options">
        <option v-for="sound in registryOptions" :key="sound" :value="sound" />
      </datalist>
      <button
        type="button"
        class="wf-source__browse"
        :disabled="disabled || (source === 'minecraft' && probing)"
        :title="source === 'minecraft' ? '在声音注册表中搜索（输入框提供候选）' : '在资源抽屉中选择音源'"
        @click="browse"
      >
        {{ source === 'minecraft' ? '搜索注册表' : '浏览' }}
      </button>
    </div>
    <div class="wf-source__status">
      <span class="wf-source__badge" :data-level="level">{{ source === 'minecraft' ? 'registry' : 'file' }}</span>
      <span v-if="probing" class="wf-source__note">正在读取资源清单…</span>
      <span v-else-if="level === 'ok'" class="wf-source__note wf-source__note--ok">路径形态通过</span>
      <span v-else class="wf-source__note" :class="{ 'wf-source__note--error': level === 'error' }">
        {{ check.messages[0] }}
      </span>
    </div>
    <p v-for="message in check.messages.slice(level === 'ok' ? 0 : 1)" :key="message" class="wf-source__hint">
      {{ message }}
    </p>
    <p v-if="!available && !probing && service !== null && service !== undefined" class="wf-source__hint">
      {{ source === 'minecraft' ? '声音注册表不可用' : '资源清单不可用' }}：只做形态检查，不判“文件/注册表不存在”。
    </p>
    <p v-if="error !== ''" class="wf-source__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-source {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 0;
}

.wf-source__line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.wf-source__input {
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

.wf-source__input:focus-visible,
.wf-source__browse:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.wf-source__browse {
  flex: 0 0 auto;
  padding: 1px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.wf-source__browse:hover:not(:disabled) {
  background: var(--bg-hover);
}

.wf-source__browse:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.wf-source__status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.wf-source__badge {
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10px;
}

.wf-source__badge[data-level='error'] {
  color: var(--error);
}

.wf-source__note {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-source__note--ok {
  color: var(--success, var(--text-secondary));
}

.wf-source__note--error {
  color: var(--error);
}

.wf-source__hint,
.wf-source__error {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.wf-source__error {
  color: var(--error);
}
</style>
