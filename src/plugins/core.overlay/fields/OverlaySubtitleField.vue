<script setup lang="ts">
/**
 * 字幕文本控件（09-05）。
 *
 * - 多行 textarea：换行是唯一折行手段（运行时不自动换行）；
 * - 预览只解析 `@lang:` 引用（当前语言 → en_us → 原样），`@@lang:` 转义；
 * - 分行、末尾空行、宽度 / 高度估算都与 `SubtitleLayer` 同口径；
 * - 保存的仍是引用串，不把译文写回脚本。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import {
  LANG_PREFIX,
  escapeLangLiteral,
  estimateSubtitleLayout,
  isEscapedLangLiteral,
  isLangReference,
  langKeyOf,
  previewSubtitleText,
  subtitleHints,
  subtitleInvisible,
  subtitleTextOf,
  suggestLangKeys,
  validateSubtitleText,
} from '../../../features/overlay/subtitle.ts'
import type { LangDictionaries, LangPreview } from '../../../features/overlay/subtitle.ts'
import {
  DEFAULT_BASE_HEIGHT,
  DEFAULT_BASE_WIDTH,
  resolutionEscape,
} from '../../../features/overlay/geometry.ts'
import type { ResourceLangList } from '../../../features/overlay/media.ts'
import { DOCUMENT_SERVICE, RESOURCE_SERVICE } from '../../../workbench/api/tokens.ts'
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

const draft = ref(subtitleTextOf(props.objects))
const error = ref('')
const notice = ref('')
const dictionaries = ref<LangDictionaries>({})
const languages = ref<string[]>([])
const language = ref('zh_cn')
const previewMode = ref<'resolved' | 'raw'>('resolved')
const langStatus = ref('尚未加载语言文件')

watch(() => subtitleTextOf(props.objects), (value) => {
  draft.value = value
})

function numberValue(path: string, fallback: number): number {
  const raw = props.objects[path]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const value = (raw as Record<string, unknown>).value
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const opacity = computed(() => numberValue('opacity', 1))
const baseResolution = computed(() => {
  void ctx.docRevision
  const raw = documents?.metaObject()?.base_resolution
  const readPair = (value: unknown): { w: number; h: number } => {
    if (!isJsonObject(value)) return { w: DEFAULT_BASE_WIDTH, h: DEFAULT_BASE_HEIGHT }
    const inner = isJsonObject(value.value) ? value.value : value
    return typeof inner.w === 'number' && Number.isFinite(inner.w) &&
      typeof inner.h === 'number' && Number.isFinite(inner.h)
      ? { w: inner.w, h: inner.h }
      : { w: DEFAULT_BASE_WIDTH, h: DEFAULT_BASE_HEIGHT }
  }
  return readPair(raw)
})
const layout = computed(() => estimateSubtitleLayout({
  text: draft.value,
  fontScale: numberValue('font_scale', 1),
  scaleX: numberValue('scale_x', 1),
  scaleY: numberValue('scale_y', 1),
  screenWidth: 1920,
  screenHeight: 1080,
  resolutionEscape: resolutionEscape(baseResolution.value.w, baseResolution.value.h, 1920, 1080),
}))
const hints = computed(() => subtitleHints(layout.value, opacity.value))
const preview = computed<LangPreview>(() => {
  if (previewMode.value === 'raw') {
    return { kind: 'literal', raw: draft.value, text: draft.value, key: null }
  }
  return previewSubtitleText(draft.value, dictionaries.value, language.value)
})
const langKey = computed(() => langKeyOf(draft.value))
const allLangKeys = computed(() => {
  const keys = new Set<string>()
  for (const dict of Object.values(dictionaries.value)) {
    for (const key of Object.keys(dict)) {
      if (langKeyOf(`${LANG_PREFIX}${key}`) !== null) keys.add(key)
    }
  }
  return [...keys].sort()
})
const keySuggestions = computed(() => {
  if (!draft.value.startsWith(LANG_PREFIX) || isEscapedLangLiteral(draft.value)) return []
  const current = Object.keys(dictionaries.value[language.value] ?? {})
  const fallback = Object.keys(dictionaries.value.en_us ?? {})
  return suggestLangKeys([...new Set([...current, ...fallback])], draft.value)
})

async function loadLanguages(): Promise<void> {
  if (resources === undefined) {
    langStatus.value = '资源服务未提供：无法加载语言文件'
    return
  }
  try {
    const result = await resources.list('lang')
    if (!('entries' in result)) {
      langStatus.value = 'resource.list 回执不是语言列表'
      return
    }
    const list = result as ResourceLangList
    const dict: LangDictionaries = {}
    for (const entry of list.entries) {
      for (const [code, text] of Object.entries(entry.values)) {
        dict[code] = dict[code] ?? {}
        dict[code][entry.key] = text
      }
    }
    dictionaries.value = dict
    languages.value = list.languages
    if (list.languages.includes('zh_cn')) {
      language.value = 'zh_cn'
    } else if (list.languages.length > 0) {
      language.value = list.languages[0]
    }
    langStatus.value = `${list.entries.length} 个 key / ${list.languages.length} 种语言${list.truncated ? '（已截断）' : ''}`
  } catch (reason) {
    langStatus.value = `语言列表不可用：${reason instanceof Error ? reason.message : String(reason)}`
  }
}

onMounted(() => {
  void loadLanguages()
})

function apply(): void {
  if (props.disabled) return
  if (draft.value === subtitleTextOf(props.objects)) {
    error.value = ''
    notice.value = '字幕文本未变化'
    return
  }
  const checked = validateSubtitleText(draft.value)
  if (!checked.ok) {
    error.value = checked.message ?? '文本非法'
    return
  }
  const outcome = commitField(
    ctx.commands,
    props.row.clipKey,
    'text',
    draft.value,
    `overlay-subtitle:${props.row.clipKey}`,
  )
  if (!outcome.ok) {
    error.value = outcome.error ?? '字幕写入失败'
    return
  }
  error.value = ''
  notice.value = `已写入 ${layout.value.lines.length} 行（保存仍是原始字符串）`
}

function escapeLiteral(): void {
  if (!isLangReference(draft.value)) return
  draft.value = escapeLangLiteral(draft.value)
  apply()
  if (error.value === '') {
    notice.value = '已写入字面量（@@lang: 输出 @lang: 本身）'
  }
}

function insertLangKey(event: Event): void {
  const key = (event.target as HTMLSelectElement).value
  if (key === '') return
  draft.value = `${LANG_PREFIX}${key}`
  apply()
}
</script>

<template>
  <div class="overlay-subtitle">
    <textarea
      v-model="draft"
      class="overlay-subtitle__text"
      rows="3"
      :disabled="disabled"
      aria-label="字幕文本（换行 = 运行时分行）"
      spellcheck="false"
      @blur="apply"
      @keydown.ctrl.enter.prevent="apply"
      @keydown.meta.enter.prevent="apply"
    />

    <div class="overlay-subtitle__actions">
      <button type="button" :disabled="disabled" @click="apply">应用文本</button>
      <button type="button" :disabled="disabled || !isLangReference(draft)" @click="escapeLiteral">
        转义为字面 @lang:
      </button>
      <span class="overlay-subtitle__lines">{{ layout.lines.length }} 行 · 末尾空行 {{ layout.trailingEmptyLines }}</span>
      <span class="overlay-subtitle__status">
        估算文字块 {{ layout.displayWidth.toFixed(0) }}×{{ layout.displayHeight.toFixed(0) }} px
        / 屏幕 {{ layout.screenWidth }}×{{ layout.screenHeight }}
      </span>
    </div>

    <div class="overlay-subtitle__lang">
      <label>
        预览语言
        <select v-model="language" :disabled="languages.length === 0">
          <option v-for="code in languages" :key="code" :value="code">{{ code }}</option>
        </select>
      </label>
      <label>
        预览
        <select v-model="previewMode">
          <option value="resolved">按语言解析</option>
          <option value="raw">原文</option>
        </select>
      </label>
      <span class="overlay-subtitle__status">{{ langStatus }}</span>
    </div>

    <div v-if="allLangKeys.length > 0" class="overlay-subtitle__lang">
      <label>
        插入语言 key
        <select :value="''" @change="insertLangKey">
          <option value="">选择 key</option>
          <option v-for="key in allLangKeys" :key="key" :value="key">{{ key }}</option>
        </select>
      </label>
      <span class="overlay-subtitle__status">选一个写入 @lang:key；保存的仍是引用串</span>
    </div>

    <p class="overlay-subtitle__preview" :data-kind="preview.kind">
      <strong>预览：</strong>{{ preview.text }}
      <span v-if="preview.kind !== 'literal'">（{{ preview.kind }}{{ preview.key === null ? '' : ` · ${preview.key}` }}）</span>
    </p>

    <ul v-if="keySuggestions.length > 0" class="overlay-subtitle__suggestions">
      <li v-for="key in keySuggestions" :key="key">
        <button type="button" @click="draft = LANG_PREFIX + key">{{ key }}</button>
      </li>
    </ul>

    <p v-if="langKey === null && draft.startsWith(LANG_PREFIX) && !isEscapedLangLiteral(draft)" class="overlay-subtitle__warning">
      引用 key 非法（1~32 位 [a-zA-Z0-9_] 分段，用 `.` 连接）；运行时会原样显示引用串。
    </p>
    <p v-if="subtitleInvisible(opacity).reason !== null" class="overlay-subtitle__warning">
      {{ subtitleInvisible(opacity).reason }}
    </p>
    <p v-for="hint in hints" :key="hint" class="overlay-subtitle__hint">{{ hint }}</p>
    <p class="overlay-subtitle__hint">不自动换行；字号 × 缩放 × 分辨率转义共同决定文字块尺寸。</p>
    <OverlayGeometrySketch kind="subtitle" :objects="objects" />
    <p v-if="notice !== ''" class="overlay-subtitle__ok" role="status">{{ notice }}</p>
    <p v-if="error !== ''" class="overlay-subtitle__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.overlay-subtitle {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.overlay-subtitle__text {
  width: 100%;
  min-height: 58px;
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  resize: vertical;
}

.overlay-subtitle__actions,
.overlay-subtitle__lang {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-subtitle__actions button {
  padding: 2px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.overlay-subtitle__lang select {
  padding: 2px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.overlay-subtitle__status {
  color: var(--text-muted);
  font-size: 10px;
}

.overlay-subtitle__preview {
  margin: 0;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
}

.overlay-subtitle__preview[data-kind='missing'],
.overlay-subtitle__preview[data-kind='invalid-key'] {
  border-color: var(--warning);
}

.overlay-subtitle__suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.overlay-subtitle__suggestions button {
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  cursor: pointer;
}

.overlay-subtitle__warning {
  margin: 0;
  color: var(--warning);
  font-size: 11px;
}

.overlay-subtitle__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.overlay-subtitle__ok {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-subtitle__error {
  margin: 0;
  color: var(--error);
  font-size: 11px;
}
</style>
