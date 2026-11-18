<script setup lang="ts">
/**
 * 媒体资源抽屉（10-08 / 10-09）。
 *
 * 两个页签：浏览 / 检查。
 * - 浏览：打开时一次列举（`resource.list(all)` + `lang`），客户端按扩展名分类；
 *   搜索 / 类型筛选 / 目录面包屑；选中文件后底部提供复制、填入、定位；
 *   只读，不读文件内容、不写资源目录。
 * - 检查：嵌入 `MediaChecksPanel`（当前片段 / 全局）。
 *
 * 资源清单不完整（请求失败、未加载完、截断）时显示状态，不把“没列出来”当成不存在。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE, RESOURCE_SERVICE } from '../../../workbench/api/tokens.ts'
import type { MediaResourceServicePort } from '../../../workbench/api/resources.ts'
import {
  extensionOf,
  parseResourceList,
  type ResourceLangEntry,
} from '../../../features/overlay/media.ts'
import { AUDIO_FILE_EXTS } from '../shared/audioSpec.ts'
import {
  getResourceFillTarget,
  subscribeResourceFillTarget,
  type ResourceFillKind,
  type ResourceFillTarget,
} from '../shared/resourceTarget.ts'
import MediaChecksPanel from '../panels/MediaChecksPanel.vue'

type FileTab = 'image' | 'video' | 'audio' | 'lut' | 'other'
type CategoryTab = FileTab | 'lang'

const ctx = usePanelContext()
const service = ctx.services.get(RESOURCE_SERVICE) as MediaResourceServicePort | null
const documentService = ctx.services.get(DOCUMENT_SERVICE)

const mode = ref<'browse' | 'checks'>('browse')
const tab = ref<CategoryTab>('image')
const filter = ref('')
const currentDir = ref('')
const selectedFile = ref<string | null>(null)
const selectedLang = ref<string | null>(null)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const available = ref(false)
const truncated = ref(false)
const allFiles = ref<string[]>([])
const languages = ref<string[]>([])
const entries = ref<ResourceLangEntry[]>([])
const target = ref<ResourceFillTarget | null>(getResourceFillTarget())

const unsubscribe = subscribeResourceFillTarget((next) => {
  target.value = next
})

onBeforeUnmount(unsubscribe)

async function load(): Promise<void> {
  if (service === null || service === undefined) {
    error.value = '资源服务未注册（插件未激活或宿主不可用）'
    available.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const [allResult, langResult] = await Promise.all([
      service.list('all' as never),
      service.list('lang' as never),
    ])
    if (allResult.kind === 'lang' || langResult.kind !== 'lang') {
      error.value = 'resource.list 回执形状不对（all 返回语言或 lang 返回文件）'
      available.value = false
      return
    }
    const files = parseResourceList(allResult as unknown as JsonValue, 'all')
    const langs = parseResourceList(langResult as unknown as JsonValue, 'lang')
    if (files === null || !('files' in files) || langs === null || !('entries' in langs)) {
      error.value = 'resource.list 回执无法解析'
      available.value = false
      return
    }
    allFiles.value = files.files
    truncated.value = files.truncated || langs.truncated
    languages.value = langs.languages
    entries.value = langs.entries
    available.value = true
    if (selectedFile.value !== null && !allFiles.value.includes(selectedFile.value)) {
      selectedFile.value = null
      notice.value = '刷新后当前选中文件已不在清单里，选中已清空（不据此判断文件不存在）。'
    }
    if (selectedLang.value !== null && !entries.value.some((entry) => entry.key === selectedLang.value)) {
      selectedLang.value = null
    }
  } catch (cause) {
    // 请求失败保留旧列表（10-08 验收）。
    error.value = cause instanceof Error ? cause.message : String(cause)
    available.value = false
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

watch(tab, () => {
  currentDir.value = ''
  selectedFile.value = null
})

/** 语言文件本身不参与媒体文件分类。 */
function classify(file: string): FileTab | null {
  const ext = extensionOf(file)
  if (ext === 'png' || ext === 'gif') return 'image'
  if (ext === 'mp4' || ext === 'webm' || ext === 'mkv') return 'video'
  if ((AUDIO_FILE_EXTS as readonly string[]).includes(ext)) return 'audio'
  if (ext === 'cube') return 'lut'
  if (ext === 'json' && file.replace(/\\/g, '/').toLowerCase().startsWith('lang/')) return null
  return 'other'
}

const filesByTab = computed<Record<FileTab, string[]>>(() => {
  const result: Record<FileTab, string[]> = { image: [], video: [], audio: [], lut: [], other: [] }
  for (const file of allFiles.value) {
    const kind = classify(file)
    if (kind !== null) result[kind].push(file)
  }
  const sorted = (files: string[]): string[] => [...files].sort((left, right) => left.localeCompare(right))
  return {
    image: sorted(result.image),
    video: sorted(result.video),
    audio: sorted(result.audio),
    lut: sorted(result.lut),
    other: sorted(result.other),
  }
})

const tabs: Array<{ id: CategoryTab; label: string }> = [
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
  { id: 'audio', label: '音频' },
  { id: 'lut', label: 'LUT' },
  { id: 'other', label: '其他' },
  { id: 'lang', label: '语言' },
]

const tabFiles = computed(() => (tab.value === 'lang' ? [] : filesByTab.value[tab.value]))

const subdirectories = computed(() => {
  const prefix = currentDir.value === '' ? '' : `${currentDir.value}/`
  const names = new Set<string>()
  for (const file of tabFiles.value) {
    if (!file.startsWith(prefix)) continue
    const rest = file.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash > 0) names.add(rest.slice(0, slash))
  }
  return [...names].sort((left, right) => left.localeCompare(right))
})

const breadcrumbs = computed(() => {
  const segments = currentDir.value === '' ? [] : currentDir.value.split('/')
  return [
    { label: '资源根', dir: '' },
    ...segments.map((segment, index) => ({
      label: segment,
      dir: segments.slice(0, index + 1).join('/'),
    })),
  ]
})

const filteredFiles = computed(() => {
  const query = filter.value.trim().toLowerCase()
  const prefix = currentDir.value === '' ? '' : `${currentDir.value}/`
  return tabFiles.value.filter((file) => {
    if (!file.startsWith(prefix)) return false
    if (query === '') return true
    return file.toLowerCase().includes(query)
  })
})

const filteredEntries = computed(() => {
  const query = filter.value.trim().toLowerCase()
  if (query === '') return entries.value
  return entries.value.filter((entry) => entry.key.toLowerCase().includes(query)
    || Object.values(entry.values).some((text) => text.toLowerCase().includes(query)))
})

const counts = computed(() => ({
  image: filesByTab.value.image.length,
  video: filesByTab.value.video.length,
  audio: filesByTab.value.audio.length,
  lut: filesByTab.value.lut.length,
  other: filesByTab.value.other.length,
  lang: entries.value.length,
}))

function normalize(path: string): string {
  return path.trim().replace(/\\/g, '/').toLowerCase()
}

/** 引用索引：只认已登记媒体字段（不扫 @lang，10-08 边界）。 */
const referenceIndex = computed(() => {
  void ctx.docRevision
  const view = documentService?.view()
  const index = new Map<string, Array<{ clipKey: string; path: string }>>()
  for (const track of view?.tracks ?? []) {
    for (const clip of track.clips) {
      const objects: JsonObject = documentService?.clipObjects(clip.clipKey) ?? {}
      for (const [path, property] of Object.entries(objects)) {
        if (typeof property !== 'object' || property === null) continue
        const value = (property as Record<string, JsonValue>).value
        if (typeof value !== 'string' || value.trim() === '') continue
        if (path === 'sound') {
          const sourceProperty = objects.source
          const source = typeof sourceProperty === 'object' && sourceProperty !== null
            ? (sourceProperty as Record<string, JsonValue>).value
            : 'file'
          if (source === 'minecraft') continue
        } else if (path !== 'lut' && path !== 'path') {
          continue
        }
        const key = normalize(value)
        const list = index.get(key) ?? []
        list.push({ clipKey: clip.clipKey, path })
        index.set(key, list)
      }
    }
  }
  return index
})

function refsFor(file: string): Array<{ clipKey: string; path: string }> {
  return referenceIndex.value.get(normalize(file)) ?? []
}

const selectedRefs = computed(() => (selectedFile.value === null ? [] : refsFor(selectedFile.value)))

const selectedKind = computed<ResourceFillKind | 'lang' | 'other' | null>(() => {
  if (selectedFile.value === null) return null
  const kind = classify(selectedFile.value)
  if (kind === null) return 'lang'
  return kind
})

function accepts(kind: ResourceFillKind | 'lang' | 'other' | null): boolean {
  const current = target.value
  if (current === null || kind === null) return false
  if (kind === 'lang' || kind === 'other') return false
  if (current.kind === 'media') return kind === 'image' || kind === 'video'
  return current.kind === kind
}

const fillReason = computed(() => {
  if (selectedFile.value === null) return '先选中一个文件'
  if (target.value === null) return '焦点不在媒体字段：先在该字段点“浏览”'
  if (!accepts(selectedKind.value)) {
    return `类型不匹配：当前字段接受 ${target.value.kind}，选中的是 ${selectedKind.value ?? '未知'}`
  }
  return ''
})

function fill(): void {
  const current = target.value
  const file = selectedFile.value
  if (current === null || file === null || !accepts(selectedKind.value)) return
  const outcome = ctx.commands.commit({
    kind: 'object.setValue',
    clipKey: current.clipKey,
    path: current.path,
    value: file as JsonValue,
  })
  if (!outcome.ok) {
    notice.value = outcome.error ?? '写入被拒绝'
    return
  }
  target.value = { ...current, current: file }
  notice.value = `已填入 ${current.path}：${file}`
}

async function copyPath(): Promise<void> {
  if (selectedFile.value === null) return
  try {
    await navigator.clipboard.writeText(selectedFile.value)
    notice.value = `已复制路径：${selectedFile.value}`
  } catch {
    notice.value = `复制失败；路径为 ${selectedFile.value}`
  }
}

function locate(ref: { clipKey: string; path: string }): void {
  ctx.requestSelect({ domain: 'object', clipKey: ref.clipKey, objectPath: ref.path })
  ctx.requestFocus('selection.properties')
  notice.value = `已定位 ${ref.clipKey} · ${ref.path}`
}

const currentLabel = computed(() => {
  const current = target.value
  if (current === null) return '未设置：先从媒体字段的“浏览”进入'
  return `${current.trackType} · ${current.path}（${current.kind}）`
})

function selectFile(file: string): void {
  selectedFile.value = file
  selectedLang.value = null
  notice.value = ''
}
</script>

<template>
  <div class="wf-resources">
    <header class="wf-resources__modes" role="tablist" aria-label="资源抽屉页签">
      <button type="button" role="tab" :aria-selected="mode === 'browse'" :class="{ 'wf-resources__mode--active': mode === 'browse' }" @click="mode = 'browse'">浏览</button>
      <button type="button" role="tab" :aria-selected="mode === 'checks'" :class="{ 'wf-resources__mode--active': mode === 'checks' }" @click="mode = 'checks'">检查</button>
    </header>

    <template v-if="mode === 'browse'">
      <header class="wf-resources__bar">
        <div class="wf-resources__tabs" role="tablist" aria-label="资源分类">
          <button
            v-for="item in tabs"
            :key="item.id"
            type="button"
            class="wf-resources__tab"
            :class="{ 'wf-resources__tab--active': tab === item.id }"
            role="tab"
            :aria-selected="tab === item.id"
            @click="tab = item.id"
          >
            {{ item.label }} <span class="wf-resources__count">{{ counts[item.id] }}</span>
          </button>
        </div>
        <input
          v-model="filter"
          class="wf-resources__filter"
          type="search"
          placeholder="按路径 / key / 文本筛选"
          aria-label="资源筛选"
        >
        <button type="button" class="wf-resources__refresh" :disabled="loading" @click="load">
          {{ loading ? '列举中…' : '刷新' }}
        </button>
      </header>

      <nav class="wf-resources__breadcrumbs" aria-label="资源目录">
        <button
          v-for="(crumb, index) in breadcrumbs"
          :key="crumb.dir"
          type="button"
          class="wf-resources__crumb"
          :disabled="index === breadcrumbs.length - 1"
          @click="currentDir = crumb.dir; selectedFile = null"
        >{{ crumb.label }}</button>
        <span class="wf-resources__dir-count">{{ subdirectories.length }} 个子目录</span>
      </nav>

      <div class="wf-resources__target">
        <span class="wf-resources__target-label">填充目标</span>
        <span class="wf-resources__target-value">{{ currentLabel }}</span>
      </div>

      <p v-if="truncated" class="wf-resources__warn">
        资源清单达到上限（truncated=true）：可能未列全；缺失检查已暂停，不据此判“文件不存在”。
      </p>
      <p v-if="error !== ''" class="wf-resources__error" role="alert">{{ error }}</p>
      <p v-if="!available && error === '' && !loading" class="wf-resources__warn">
        资源列表不可用（游戏未运行 / WebUI 未连接）：保留空清单，不写假数据。
      </p>
      <p v-if="notice !== ''" class="wf-resources__notice" role="status">{{ notice }}</p>

      <div v-if="tab !== 'other' && tab !== 'lang'" class="wf-resources__dirs">
        <button
          v-for="dir in subdirectories"
          :key="dir"
          type="button"
          class="wf-resources__dir"
          @click="currentDir = currentDir === '' ? dir : `${currentDir}/${dir}`; selectedFile = null"
        >📁 {{ dir }}</button>
      </div>

      <div v-if="tab !== 'other' && tab !== 'lang'" class="wf-resources__list" role="tabpanel">
        <p v-if="filteredFiles.length === 0" class="wf-resources__empty">
          {{ available ? '该分类没有文件' : '资源列表不可用' }}
        </p>
        <div
          v-for="file in filteredFiles"
          :key="file"
          class="wf-resources__row"
          :class="{
            'wf-resources__row--current': target !== null && normalize(target.current) === normalize(file),
            'wf-resources__row--selected': selectedFile === file,
          }"
          @click="selectFile(file)"
        >
          <span class="wf-resources__file" :title="file">
            {{ currentDir === '' ? file : file.slice(currentDir.length + 1) }}
          </span>
          <span class="wf-resources__refs">{{ refsFor(file).length }} 引用</span>
          <span v-if="target !== null && normalize(target.current) === normalize(file)" class="wf-resources__badge">当前</span>
        </div>
      </div>

      <div v-else-if="tab === 'other'" class="wf-resources__list" role="tabpanel">
        <p class="wf-resources__empty">其他文件只读，可复制路径；不能填入媒体字段。</p>
        <div v-for="file in filteredFiles" :key="file" class="wf-resources__row" @click="selectFile(file)">
          <span class="wf-resources__file">{{ file }}</span>
        </div>
      </div>

      <section v-else class="wf-resources__lang" aria-label="语言页签">
        <header class="wf-resources__lang-head">
          <span class="wf-resources__lang-title">语言</span>
          <span class="wf-resources__lang-codes">{{ languages.join(' / ') || '未发现语言文件' }}</span>
        </header>
        <p class="wf-resources__lang-note">只读键值矩阵；不新增、不编辑、不删除译文。语言键不填入媒体字段。</p>
        <div class="wf-resources__lang-list">
          <div v-for="entry in filteredEntries" :key="entry.key" class="wf-resources__lang-row">
            <span class="wf-resources__lang-key">{{ entry.key }}</span>
            <span v-for="language in languages" :key="language" class="wf-resources__lang-value">
              <b>{{ language }}</b>{{ entry.values[language] ?? '（缺失）' }}
            </span>
          </div>
        </div>
      </section>

      <footer v-if="tab !== 'lang'" class="wf-resources__actions">
        <button type="button" :disabled="selectedFile === null" @click="copyPath">复制路径</button>
        <button type="button" :disabled="fillReason !== ''" :title="fillReason" @click="fill">填入当前字段</button>
        <button
          type="button"
          :disabled="selectedRefs.length === 0"
          @click="selectedRefs[0] && locate(selectedRefs[0])"
        >定位引用（{{ selectedRefs.length }}）</button>
      </footer>
      <p v-if="fillReason !== ''" class="wf-resources__reason">{{ fillReason }}</p>
      <div v-if="selectedRefs.length > 0" class="wf-resources__refs-list">
        <span class="wf-resources__refs-title">引用位置</span>
        <button
          v-for="ref in selectedRefs"
          :key="`${ref.clipKey}:${ref.path}`"
          type="button"
          class="wf-resources__ref"
          @click="locate(ref)"
        >{{ ref.clipKey }} · {{ ref.path }}</button>
      </div>

      <footer class="wf-resources__foot">
        <span>文件 {{ allFiles.length }} · 语言 {{ entries.length }}</span>
        <span v-if="truncated" class="wf-resources__warn">可能未列全</span>
      </footer>
    </template>

    <template v-else>
      <div class="wf-resources__checks">
        <MediaChecksPanel />
      </div>
    </template>
  </div>
</template>

<style scoped>
.wf-resources {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
}

.wf-resources__modes {
  display: flex;
  gap: 3px;
  padding: 5px 10px 0;
  border-bottom: 1px solid var(--border);
}

.wf-resources__modes button {
  padding: 3px 12px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 3px 3px 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.wf-resources__modes button.wf-resources__mode--active {
  border-color: var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
}

.wf-resources__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.wf-resources__tabs {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
}

.wf-resources__tab {
  padding: 2px 7px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.wf-resources__tab--active {
  border-color: var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
}

.wf-resources__count {
  color: var(--text-muted);
  font-size: 9px;
}

.wf-resources__filter {
  flex: 1 1 160px;
  min-width: 120px;
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.wf-resources__refresh {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.wf-resources__breadcrumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 10px;
  overflow-x: auto;
}

.wf-resources__crumb {
  padding: 0 4px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
}

.wf-resources__crumb:disabled {
  color: var(--text);
  cursor: default;
}

.wf-resources__dir-count {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 9px;
  white-space: nowrap;
}

.wf-resources__target {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 10px;
}

.wf-resources__target-label {
  color: var(--text-muted);
}

.wf-resources__target-value {
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-resources__warn,
.wf-resources__error,
.wf-resources__notice {
  margin: 0;
  padding: 4px 10px;
  font-size: 10px;
}

.wf-resources__warn {
  color: var(--warning);
}

.wf-resources__error {
  color: var(--error);
}

.wf-resources__notice {
  color: var(--text-secondary);
}

.wf-resources__dirs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
}

.wf-resources__dir {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.wf-resources__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 6px;
}

.wf-resources__empty {
  margin: 6px;
  color: var(--text-muted);
  font-size: 11px;
}

.wf-resources__row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 4px;
  border-radius: 3px;
  min-width: 0;
  cursor: pointer;
}

.wf-resources__row:hover {
  background: var(--bg-hover);
}

.wf-resources__row--current {
  background: var(--bg-raised);
}

.wf-resources__row--selected {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.wf-resources__file {
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-resources__refs {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 9px;
}

.wf-resources__badge {
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--accent-soft, var(--bg-hover));
  color: var(--accent);
  font-size: 9px;
}

.wf-resources__actions {
  display: flex;
  gap: 6px;
  padding: 5px 10px;
  border-top: 1px solid var(--border);
}

.wf-resources__actions button {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.wf-resources__actions button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.wf-resources__actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wf-resources__reason {
  margin: 0;
  padding: 0 10px 4px;
  color: var(--text-muted);
  font-size: 10px;
}

.wf-resources__refs-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 10px;
  border-top: 1px dashed var(--border);
}

.wf-resources__refs-title {
  color: var(--text-muted);
  font-size: 10px;
}

.wf-resources__ref {
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 9px;
  cursor: pointer;
}

.wf-resources__foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 9px;
}

.wf-resources__lang {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 10px;
}

.wf-resources__lang-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wf-resources__lang-title {
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
}

.wf-resources__lang-codes {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.wf-resources__lang-note {
  margin: 4px 0;
  color: var(--text-muted);
  font-size: 10px;
}

.wf-resources__lang-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wf-resources__lang-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 3px 4px;
  border-bottom: 1px solid var(--border);
  font-size: 10px;
}

.wf-resources__lang-key {
  flex: 0 0 180px;
  color: var(--text);
  font-family: var(--font-mono);
}

.wf-resources__lang-value {
  color: var(--text-muted);
}

.wf-resources__lang-value b {
  margin-right: 3px;
  color: var(--text-secondary);
  font-weight: 500;
}

.wf-resources__checks {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
</style>
