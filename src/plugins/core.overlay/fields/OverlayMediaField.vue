<script setup lang="ts">
/**
 * 素材路径控件（09-03 / 09-04）。
 *
 * 用户裁决：图片组只列 png/gif，视频组只列 mp4/webm/mkv；两组写入同一个 `path`。
 * 列表来自既有 `resource.list` 消息；列表不可用时只提示，不把「没列出来」当成确定缺失。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import {
  filterMediaFiles,
  mediaPathOf,
  mediaPresence,
  mediaPresenceLabel,
  parseResourceList,
  validateMediaPathInput,
  VIDEO_LAYER_NOTE,
} from '../../../features/overlay/media.ts'
import type { ResourceFileList } from '../../../features/overlay/media.ts'
import { RESOURCE_SERVICE, DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import OverlayGeometrySketch from '../components/OverlayGeometrySketch.vue'
import { commitField } from '../commit.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const resources = ctx.services.get(RESOURCE_SERVICE)
const documents = ctx.services.get(DOCUMENT_SERVICE)

const imageFiles = ref<string[] | null>(null)
const videoFiles = ref<string[] | null>(null)
const listingAvailable = ref(false)
const listingMessage = ref('')
const loading = ref(false)
const draft = ref(mediaPathOf(props.objects))
const notice = ref('')
const error = ref('')

const currentPath = computed(() => mediaPathOf(props.objects))
watch(currentPath, (value) => {
  draft.value = value
})
const allFiles = computed(() => [...(imageFiles.value ?? []), ...(videoFiles.value ?? [])])
const presence = computed(() => mediaPresence(currentPath.value, allFiles.value, listingAvailable.value))
const pathLooksVideo = computed(() => /\.(mp4|webm|mkv)$/i.test(currentPath.value))
const baseResolution = computed(() => {
  void ctx.docRevision
  const raw = documents?.metaObject()?.base_resolution
  const readPair = (value: unknown): string | null => {
    if (!isJsonObject(value)) return null
    const inner = isJsonObject(value.value) ? value.value : value
    return typeof inner.w === 'number' && Number.isFinite(inner.w) &&
      typeof inner.h === 'number' && Number.isFinite(inner.h)
      ? `${inner.w}×${inner.h}`
      : null
  }
  return readPair(raw) ?? '1920×1080（缺省）'
})

async function refresh(): Promise<void> {
  if (resources === undefined) {
    listingAvailable.value = false
    listingMessage.value = '资源服务未提供：未连接游戏实例时无法列举 resource/'
    return
  }
  loading.value = true
  listingMessage.value = ''
  try {
    const [imageResult, videoResult] = await Promise.all([
      resources.list('image'),
      resources.list('video'),
    ])
    const imageList = parseResourceList(imageResult as unknown as JsonValue, 'image') as ResourceFileList | null
    const videoList = parseResourceList(videoResult as unknown as JsonValue, 'video') as ResourceFileList | null
    if (imageList === null || videoList === null) {
      listingAvailable.value = false
      listingMessage.value = 'resource.list 回执结构非法：资源列表不可用'
    } else {
      imageFiles.value = filterMediaFiles(imageList.files, 'image')
      videoFiles.value = filterMediaFiles(videoList.files, 'video')
      listingAvailable.value = true
      const truncated = imageList.truncated || videoList.truncated
      listingMessage.value = truncated ? '资源列表已截断（只显示前一部分）' : ''
    }
  } catch (reason) {
    listingAvailable.value = false
    listingMessage.value = `资源列表不可用：${reason instanceof Error ? reason.message : String(reason)}`
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  draft.value = currentPath.value
  void refresh()
})

function apply(input: string): void {
  if (props.disabled) return
  const checked = validateMediaPathInput(input)
  if (!checked.ok) {
    error.value = checked.message ?? '素材路径非法'
    return
  }
  if (checked.path !== '' && checked.path === currentPath.value) {
    error.value = ''
    notice.value = '素材路径未变化'
    draft.value = checked.path
    return
  }
  if (checked.path === '') {
    if (currentPath.value === '') {
      error.value = ''
      notice.value = '素材路径已是空'
      draft.value = ''
      return
    }
    const outcome = ctx.commands.commitBatch(
      [{ kind: 'object.remove', clipKey: props.row.clipKey, path: 'path' }],
      `overlay-media:${props.row.clipKey}`,
    )
    if (!outcome.ok) {
      error.value = outcome.error ?? '清空素材路径失败'
      return
    }
    error.value = ''
    notice.value = '已清空素材路径（只删 path，层不绘制、不占位）'
    draft.value = ''
    return
  }
  const outcome = commitField(
    ctx.commands,
    props.row.clipKey,
    'path',
    checked.path,
    `overlay-media:${props.row.clipKey}`,
  )
  if (!outcome.ok) {
    error.value = outcome.error ?? '素材路径写入失败'
    return
  }
  error.value = ''
  notice.value = `已写入 ${checked.path}`
  draft.value = checked.path
}

function choose(path: string): void {
  draft.value = path
  apply(path)
}
</script>

<template>
  <div class="overlay-media">
    <div class="overlay-media__row">
      <input
        v-model="draft"
        type="text"
        class="overlay-media__input"
        :disabled="disabled"
        aria-label="素材路径（相对 resource/）"
        placeholder="例如 images/photo.png"
        spellcheck="false"
        @blur="apply(draft)"
        @keydown.enter.prevent="apply(draft)"
      >
      <button type="button" class="overlay-media__refresh" :disabled="loading" @click="refresh">
        {{ loading ? '列举中…' : '刷新列表' }}
      </button>
      <button type="button" class="overlay-media__clear" :disabled="disabled" @click="choose('')">
        清空
      </button>
    </div>

    <p class="overlay-media__presence" :data-presence="presence">
      {{ mediaPresenceLabel(presence) }}
      <span v-if="listingMessage !== ''"> · {{ listingMessage }}</span>
    </p>

    <div class="overlay-media__groups">
      <label class="overlay-media__group">
        <span>图片（png / gif）</span>
        <select :disabled="disabled || imageFiles === null" @change="choose(($event.target as HTMLSelectElement).value)">
          <option value="">未选择</option>
          <option v-for="file in imageFiles ?? []" :key="file" :value="file" :selected="file === currentPath">
            {{ file }}
          </option>
        </select>
      </label>
      <label class="overlay-media__group">
        <span>视频（mp4 / webm / mkv）</span>
        <select :disabled="disabled || videoFiles === null" @change="choose(($event.target as HTMLSelectElement).value)">
          <option value="">未选择</option>
          <option v-for="file in videoFiles ?? []" :key="file" :value="file" :selected="file === currentPath">
            {{ file }}
          </option>
        </select>
      </label>
    </div>

    <p v-if="pathLooksVideo" class="overlay-media__note">{{ VIDEO_LAYER_NOTE }}</p>
    <p class="overlay-media__hint">空路径不绘制、不占位；不存在的路径同样不占位（视频在有工具链时显示错误纹理）。</p>
    <p class="overlay-media__hint">scale = 1 按素材原始像素显示，2 = 两倍；缩放同时作用于元素框与锚点定位，不改 path，也不改取材四边（取材仍归一化到素材）。</p>
    <p class="overlay-media__hint">基准分辨率（脚本元数据，只读）：{{ baseResolution }}；scale 相对素材像素。</p>
    <OverlayGeometrySketch kind="image" :objects="objects" />
    <p v-if="notice !== ''" class="overlay-media__ok" role="status">{{ notice }}</p>
    <p v-if="error !== ''" class="overlay-media__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.overlay-media {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.overlay-media__row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.overlay-media__input {
  flex: 1 1 220px;
  min-width: 140px;
  padding: 2px 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.overlay-media__row button {
  padding: 2px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.overlay-media__groups {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}

.overlay-media__group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-media__group select {
  max-width: 100%;
  padding: 2px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.overlay-media__presence,
.overlay-media__note,
.overlay-media__hint,
.overlay-media__ok,
.overlay-media__error {
  margin: 0;
  font-size: 11px;
}

.overlay-media__presence {
  color: var(--text-secondary);
}

.overlay-media__presence[data-presence='missing'] {
  color: var(--warning);
}

.overlay-media__presence[data-presence='unknown'] {
  color: var(--text-muted);
}

.overlay-media__note,
.overlay-media__hint {
  color: var(--text-muted);
  font-size: 10px;
}

.overlay-media__ok {
  color: var(--text-secondary);
}

.overlay-media__error {
  color: var(--error);
}
</style>
