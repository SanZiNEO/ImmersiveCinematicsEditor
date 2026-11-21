<script setup lang="ts">
/**
 * 媒体检查页签（10-09）：当前片段 / 全局两个范围，按资源、音频、调色三组列出。
 *
 * 只读文档与资源清单；问题点击只改变界面焦点（选择 / 面板 / 曲线页签），
 * 不动文档、不移动播放头。
 */
import { computed, onMounted, ref } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE, RESOURCE_SERVICE } from '../../../workbench/api/tokens.ts'
import type { MediaResourceServicePort } from '../../../workbench/api/resources.ts'
import {
  buildMediaCheckReport,
  highestSeverity,
  sortCheckItems,
  type MediaCheckGroup,
  type MediaCheckItem,
  type MediaCheckReport,
  type MediaCheckSeverity,
  type MediaDocSnapshot,
  type MediaResourceSnapshot,
} from '../shared/mediaChecks.ts'
import { AUDIO_FILE_EXTS } from '../shared/audioSpec.ts'
import { extensionOf } from '../../../features/overlay/media.ts'
import { setCurveTarget } from '../shared/curveTarget.ts'

const ctx = usePanelContext()
const service = ctx.services.get(RESOURCE_SERVICE) as MediaResourceServicePort | null
const documentService = ctx.services.get(DOCUMENT_SERVICE)

const scope = ref<'current' | 'global'>('current')
const loading = ref(false)
const error = ref('')
const loadError = ref('')
const snapshot = ref<MediaResourceSnapshot>({
  available: false,
  loaded: false,
  atRoot: true,
  truncated: false,
  audio: null,
  image: null,
  video: null,
  files: null,
  langKeys: null,
  registrySounds: null,
})

async function load(): Promise<void> {
  if (service === null || service === undefined) {
    loadError.value = '资源服务未注册（插件未激活）'
    snapshot.value = { ...snapshot.value, available: false, loaded: false }
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    const all = await service.list('all' as never)
    const lang = await service.list('lang' as never)
    if (!('files' in all) || !('entries' in lang)) {
      loadError.value = 'resource.list 回执形状不符'
      snapshot.value = { ...snapshot.value, available: false, loaded: false }
      return
    }
    const files = all.files.map((file: string) => file.replace(/\\/g, '/').toLowerCase())
    const filesSet = new Set(files)
    const audio = new Set(files.filter((file: string) => (AUDIO_FILE_EXTS as readonly string[]).includes(extensionOf(file))))
    const image = new Set(files.filter((file: string) => extensionOf(file) === 'png' || extensionOf(file) === 'gif'))
    const video = new Set(files.filter((file: string) => ['mp4', 'webm', 'mkv'].includes(extensionOf(file))))
    const langKeys = new Set(lang.entries.map((entry) => entry.key))
    let registrySounds: Set<string> | null = null
    if (typeof service.queryRegistry === 'function') {
      try {
        const sounds = await service.queryRegistry('sound', '', 500)
        registrySounds = new Set(sounds.map((sound) => sound.toLowerCase()))
      } catch {
        registrySounds = null
      }
    }
    snapshot.value = {
      available: true,
      loaded: true,
      atRoot: true,
      truncated: all.truncated || lang.truncated,
      audio,
      image,
      video,
      files: filesSet,
      langKeys,
      registrySounds,
    }
  } catch (cause) {
    // 保留旧列表，只把可用性降级（10-08/10-09：请求失败不能清空）。
    loadError.value = cause instanceof Error ? cause.message : String(cause)
    snapshot.value = { ...snapshot.value, available: false, loaded: false, atRoot: true }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

function docSnapshot(): MediaDocSnapshot {
  const view = documentService?.view()
  const meta = documentService?.metaObject() ?? {}
  const tracks = (view?.tracks ?? []).map((track) => ({
    trackId: track.trackId,
    type: track.type,
    name: track.name,
    clips: track.clips.map((clip) => ({
      clipKey: clip.clipKey,
      trackType: track.type,
      start: clip.start,
      duration: clip.duration,
      infinite: clip.infinite,
      loop: clip.loop,
      loopCount: clip.loopCount,
      objects: documentService?.clipObjects(clip.clipKey) ?? {},
    })),
  }))
  return {
    tracks,
    meta,
    playhead: documentService?.sessionView().playhead ?? 0,
    contentEnd: view?.contentEnd ?? null,
  }
}

const report = computed<MediaCheckReport>(() => {
  void ctx.docRevision
  return buildMediaCheckReport(docSnapshot(), snapshot.value)
})

const currentClip = computed(() => {
  const selection = ctx.selection
  if (selection.domain === 'clip' || selection.domain === 'object' || selection.domain === 'keyframe') {
    return selection.clipKey ?? null
  }
  return null
})

const visibleItems = computed(() => {
  const all = report.value.items
  if (scope.value === 'global') return all
  if (currentClip.value === null) return []
  return all.filter((item) => item.clipKey === currentClip.value
    || (item.objectPath === 'meta.listener' && item.clipKey === undefined))
})

const counts = computed(() => ({
  block: visibleItems.value.filter((item) => item.severity === 'block').length,
  error: visibleItems.value.filter((item) => item.severity === 'error').length,
  warning: visibleItems.value.filter((item) => item.severity === 'warning').length,
  info: visibleItems.value.filter((item) => item.severity === 'info').length,
  unverified: visibleItems.value.filter((item) => item.severity === 'unverified').length,
}))

const groups: Array<{ id: MediaCheckGroup; label: string }> = [
  { id: 'resource', label: '资源引用' },
  { id: 'audio', label: '音频' },
  { id: 'color', label: '调色' },
]

function groupItems(group: MediaCheckGroup): MediaCheckItem[] {
  return sortCheckItems(visibleItems.value.filter((item) => item.group === group))
}

function groupLevel(group: MediaCheckGroup): MediaCheckSeverity | null {
  return highestSeverity(groupItems(group))
}

const SEVERITY_LABEL: Record<MediaCheckSeverity, string> = {
  block: '阻断',
  error: '错误',
  warning: '警告',
  info: '提示',
  unverified: '未知',
}

function locate(item: MediaCheckItem): void {
  if (item.objectPath === 'meta.listener') {
    // 脚本参数已并入右栏检查器：先回到空选区（脚本页），再聚焦同一面板。
    ctx.requestSelect({ domain: 'none' })
    ctx.requestFocus('selection.properties')
    return
  }
  if (item.clipKey === undefined) {
    if (item.code === 'M20') {
      ctx.requestFocus('timeline.main')
      return
    }
    // 资源/素材级问题没有片段归属：打开资源抽屉，不伪造片段选择。
    ctx.requestOpenDrawer('resources')
    return
  }
  ctx.requestSelect({
    domain: item.objectPath === undefined ? 'clip' : 'object',
    clipKey: item.clipKey,
    ...(item.objectPath === undefined ? {} : { objectPath: item.objectPath }),
  })
  if (item.curve !== undefined) {
    setCurveTarget({ key: item.curve, clipKey: item.clipKey })
    ctx.requestOpenDrawer('color-curves')
    return
  }
  ctx.requestFocus('selection.properties')
}
</script>

<template>
  <div class="wf-checks">
    <header class="wf-checks__bar">
      <div class="wf-checks__scopes" role="tablist" aria-label="检查范围">
        <button
          type="button"
          class="wf-checks__scope"
          :class="{ 'wf-checks__scope--active': scope === 'current' }"
          role="tab"
          :aria-selected="scope === 'current'"
          @click="scope = 'current'"
        >当前片段</button>
        <button
          type="button"
          class="wf-checks__scope"
          :class="{ 'wf-checks__scope--active': scope === 'global' }"
          role="tab"
          :aria-selected="scope === 'global'"
          @click="scope = 'global'"
        >全局</button>
      </div>
      <button type="button" class="wf-checks__refresh" :disabled="loading" @click="load">
        {{ loading ? '检查中…' : '重新检查' }}
      </button>
    </header>

    <div class="wf-checks__counts" aria-label="按级别统计">
      <span data-severity="block">阻断 {{ counts.block }}</span>
      <span data-severity="error">错误 {{ counts.error }}</span>
      <span data-severity="warning">警告 {{ counts.warning }}</span>
      <span data-severity="info">提示 {{ counts.info }}</span>
      <span data-severity="unverified">未知 {{ counts.unverified }}</span>
    </div>

    <p v-if="scope === 'current' && currentClip === null" class="wf-checks__notice">
      “当前片段”范围需要先选中一个片段；切到“全局”可看整份文档。
    </p>
    <p v-if="report.pausedReason !== null" class="wf-checks__pause">
      {{ report.pausedReason }}
    </p>
    <p v-if="loadError !== ''" class="wf-checks__error" role="alert">{{ loadError }}</p>
    <p v-if="error !== ''" class="wf-checks__error" role="alert">{{ error }}</p>

    <div v-if="visibleItems.length === 0" class="wf-checks__empty">
      {{ scope === 'current' && currentClip === null ? '未选中片段' : '当前范围无问题' }}
    </div>

    <div v-for="group in groups" :key="group.id" class="wf-checks__group">
      <template v-if="groupItems(group.id).length > 0">
        <h3 class="wf-checks__group-head" :data-severity="groupLevel(group.id)">
          <span>{{ group.label }}</span>
          <span class="wf-checks__group-count">{{ groupItems(group.id).length }}</span>
          <span v-if="groupLevel(group.id) !== null" class="wf-checks__group-level">{{ SEVERITY_LABEL[groupLevel(group.id)!] }}</span>
        </h3>
        <ul class="wf-checks__list">
          <li v-for="item in groupItems(group.id)" :key="item.id" class="wf-checks__item" :data-severity="item.severity">
            <button type="button" class="wf-checks__code" :title="`定位 ${item.code}`" @click="locate(item)">
              {{ item.code }}
            </button>
            <span class="wf-checks__badge" :data-severity="item.severity">{{ SEVERITY_LABEL[item.severity] }}</span>
            <span class="wf-checks__message">{{ item.message }}</span>
            <span class="wf-checks__where">
              {{ item.clipKey ?? '' }}<template v-if="item.objectPath"> · {{ item.objectPath }}</template>
            </span>
            <button type="button" class="wf-checks__locate" @click="locate(item)">定位</button>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wf-checks {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg-panel);
}

.wf-checks__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.wf-checks__scopes {
  display: flex;
  gap: 3px;
}

.wf-checks__scope {
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.wf-checks__scope--active {
  border-color: var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
}

.wf-checks__refresh {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.wf-checks__counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 10px;
}

.wf-checks__counts [data-severity='block'] { color: var(--error); font-weight: 600; }
.wf-checks__counts [data-severity='error'] { color: var(--error); }
.wf-checks__counts [data-severity='warning'] { color: var(--warning); }
.wf-checks__counts [data-severity='info'] { color: var(--text-secondary); }
.wf-checks__counts [data-severity='unverified'] { color: var(--text-muted); }

.wf-checks__notice,
.wf-checks__pause,
.wf-checks__error,
.wf-checks__empty {
  margin: 0;
  padding: 5px 10px;
  font-size: 10px;
}

.wf-checks__notice,
.wf-checks__empty {
  color: var(--text-muted);
}

.wf-checks__pause {
  color: var(--warning);
}

.wf-checks__error {
  color: var(--error);
}

.wf-checks__group {
  padding: 3px 8px 6px;
}

.wf-checks__group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 11px;
  font-weight: 500;
}

.wf-checks__group-head[data-severity='block'],
.wf-checks__group-head[data-severity='error'] {
  color: var(--error);
}

.wf-checks__group-head[data-severity='warning'] {
  color: var(--warning);
}

.wf-checks__group-count {
  color: var(--text-muted);
  font-weight: 400;
}

.wf-checks__group-level {
  margin-left: auto;
  font-size: 9px;
}

.wf-checks__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wf-checks__item {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto auto;
  gap: 5px;
  align-items: start;
  padding: 3px 4px;
  border-radius: 3px;
  font-size: 10px;
}

.wf-checks__item:hover {
  background: var(--bg-hover);
}

.wf-checks__code {
  padding: 0 3px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 9px;
  cursor: pointer;
}

.wf-checks__badge {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9px;
  white-space: nowrap;
}

.wf-checks__badge[data-severity='block'],
.wf-checks__badge[data-severity='error'] {
  background: color-mix(in srgb, var(--error) 18%, transparent);
  color: var(--error);
}

.wf-checks__badge[data-severity='warning'] {
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  color: var(--warning);
}

.wf-checks__badge[data-severity='info'] {
  background: var(--bg-raised);
  color: var(--text-secondary);
}

.wf-checks__badge[data-severity='unverified'] {
  background: var(--bg-raised);
  color: var(--text-muted);
}

.wf-checks__message {
  color: var(--text);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.wf-checks__where {
  grid-column: 3;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  overflow-wrap: anywhere;
}

.wf-checks__locate {
  grid-column: 5;
  grid-row: 1 / span 2;
  align-self: center;
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 9px;
  cursor: pointer;
}
</style>
