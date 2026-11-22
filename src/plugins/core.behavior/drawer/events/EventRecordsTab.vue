<script setup lang="ts">
/**
 * 行为抽屉 · 事件页签（11-12 EVENT / 11-13 MOD_EVENT）。
 *
 * 左列按轨道（EVENT / MOD_EVENT）与片段分组列出全部事件记录；右栏是唯一详情编辑器
 * （`EventRecordDetail.vue`，字段控件与命令翻译复用 `features/effects/eventRecords.ts`）。
 *
 * 选择身份只用 `RecordRef`（片段 + 对象路径 + 下标），不用数组下标；本组件不写主选择，
 * 选中与「定位到片段」通过 emits 交给外壳。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { JsonObject } from '../../../../core/doc/types.ts'
import { usePanelContext } from '../../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE } from '../../../../workbench/api/tokens.ts'
import { usePanelRevision } from '../../usePanelRevision.ts'
import {
  describeEventRecord,
  eventRecords,
  type ClipEventContext,
  type EventRecordNode,
} from '../../../../features/behavior/events.ts'
import type { EventTrackType } from '../../../../core/schema/catalog/behaviorEvents.ts'
import {
  recordRefKey,
  sameRecordRef,
  type RecordRef,
} from '../../../../features/behavior/shared.ts'
import { onFocus, takeFocus } from '../../../../features/behavior/focus.ts'
import { enumerateRawClips } from '../../../core.timeline/eventMarkers.ts'
import EventRecordDetail from './EventRecordDetail.vue'

const props = defineProps<{
  docRevision: number
  selected: RecordRef | null
}>()

const emits = defineEmits<{
  select: [ref: RecordRef]
  'open-clip': [clipKey: string]
}>()

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)

/** 消费发往行为抽屉的一次性定位请求（效果面板 / 片段属性「在行为页打开」）。 */
const focused = ref<RecordRef | null>(null)
let unsubscribeFocus: (() => void) | null = null

onMounted(() => {
  const pending = takeFocus('behavior-drawer')
  if (pending !== null) {
    focused.value = pending.target
  }
  unsubscribeFocus = onFocus((request) => {
    if (request.surface === 'behavior-drawer') {
      focused.value = request.target
    }
  })
})

onUnmounted(() => {
  unsubscribeFocus?.()
  unsubscribeFocus = null
})

const root = computed<JsonObject | null>(() => {
  void revision.value
  void props.docRevision
  return documentService?.root() ?? null
})

/**
 * 行为记录身份保留 JSON 路径；文档读取与命令改用注册表片段键。
 *
 * `eventRecords()` 与 `enumerateRawClips()` 按同一文档顺序枚举内联 / 独立片段，
 * `DocumentService.clips()` 也按同一存活片段顺序返回注册表键。这里按顺序一一配对，
 * 不按可能重复的运行时 id 猜测，也不会被非对象槽位改变原始路径下标。
 */
const registryKeys = computed<ReadonlyMap<string, string>>(() => {
  const currentRoot = root.value
  if (currentRoot === null || documentService === undefined) {
    return new Map()
  }
  const raw = enumerateRawClips(currentRoot)
  const clips = documentService.clips()
  if (raw.length !== clips.length) {
    return new Map()
  }
  return new Map(raw.map((clip, index) => [clip.path, clips[index].clipKey]))
})

function registryKeyOf(path: string): string {
  return registryKeys.value.get(path) ?? path
}

/** 片段显示名与播放上下文（起始 / 时长 / 无限），用于摘要全局时间换算。 */
interface ClipInfo {
  label: string
  ctx: ClipEventContext
}

const clipInfo = computed<ReadonlyMap<string, ClipInfo>>(() => {
  const map = new Map<string, ClipInfo>()
  const view = documentService?.view()
  if (view === undefined || view === null) {
    return map
  }
  for (const track of view.tracks) {
    for (const clip of track.clips) {
      map.set(clip.clipKey, {
        label: clip.label,
        ctx: {
          clipStartTime: clip.start,
          duration: clip.duration,
          infinite: clip.infinite,
        },
      })
    }
  }
  return map
})

const nodes = computed<EventRecordNode[]>(() => {
  if (root.value === null) {
    return []
  }
  return eventRecords(root.value)
})

/** 同一事件对象内的记录总数（唯一记录不可删）。 */
const siblingCounts = computed<ReadonlyMap<string, number>>(() => {
  const counts = new Map<string, number>()
  for (const node of nodes.value) {
    const key = `${node.clipKey}|${node.objectPath}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
})

function siblingKey(node: EventRecordNode): string {
  return `${node.clipKey}|${node.objectPath}`
}

interface ClipGroup {
  clipKey: string
  registryKey: string
  label: string
  ctx: ClipEventContext
  nodes: EventRecordNode[]
}

interface TrackGroup {
  trackType: EventTrackType
  clips: ClipGroup[]
}

const trackGroups = computed<TrackGroup[]>(() => {
  const byTrack = new Map<EventTrackType, Map<string, EventRecordNode[]>>()
  for (const node of nodes.value) {
    let byClip = byTrack.get(node.trackType)
    if (byClip === undefined) {
      byClip = new Map<string, EventRecordNode[]>()
      byTrack.set(node.trackType, byClip)
    }
    const list = byClip.get(node.clipKey) ?? []
    list.push(node)
    byClip.set(node.clipKey, list)
  }
  const order: EventTrackType[] = ['EVENT', 'MOD_EVENT']
  const groups: TrackGroup[] = []
  for (const trackType of order) {
    const byClip = byTrack.get(trackType)
    if (byClip === undefined || byClip.size === 0) {
      continue
    }
    const clips: ClipGroup[] = []
    for (const [clipKey, clipNodes] of byClip) {
      const registryKey = registryKeyOf(clipKey)
      const info = clipInfo.value.get(registryKey)
      clips.push({
        clipKey,
        registryKey,
        label: info?.label ?? clipKey,
        ctx: info?.ctx ?? { clipStartTime: 0, duration: 0, infinite: false },
        nodes: clipNodes,
      })
    }
    groups.push({ trackType, clips })
  }
  return groups
})

const activeRef = computed<RecordRef | null>(() => props.selected ?? focused.value)

const selectedNode = computed<EventRecordNode | undefined>(() => {
  if (activeRef.value === null) {
    return undefined
  }
  return nodes.value.find((node) => sameRecordRef(node.ref, activeRef.value!))
})

const selectedRegistryKey = computed<string | null>(() => {
  if (selectedNode.value === undefined) {
    return null
  }
  return registryKeyOf(selectedNode.value.clipKey)
})

/** 详情编辑器只换命令 / 文档读取键；`ref` 仍是行为模型的原始路径身份。 */
const selectedDetailNode = computed<EventRecordNode | undefined>(() => {
  if (selectedNode.value === undefined || selectedRegistryKey.value === null) {
    return undefined
  }
  return { ...selectedNode.value, clipKey: selectedRegistryKey.value }
})

const selectedObjects = computed<JsonObject | null>(() => {
  if (selectedRegistryKey.value === null) {
    return null
  }
  return documentService?.clipObjects(selectedRegistryKey.value) ?? null
})

function describe(node: EventRecordNode): string {
  const info = clipInfo.value.get(registryKeyOf(node.clipKey))
  return describeEventRecord(node, info?.ctx)
}

function problemCount(node: EventRecordNode): number {
  return node.problems.length
}

function isActive(node: EventRecordNode): boolean {
  return activeRef.value !== null && sameRecordRef(node.ref, activeRef.value)
}

function selectNode(node: EventRecordNode): void {
  focused.value = node.ref
  emits('select', node.ref)
}

function openClip(clipKey: string): void {
  emits('open-clip', clipKey)
}

function groupTitle(trackType: EventTrackType): string {
  return trackType === 'EVENT' ? 'EVENT 命令事件' : 'MOD_EVENT 模组事件'
}

function nodeKey(node: EventRecordNode): string {
  return recordRefKey(node.ref)
}
</script>

<template>
  <section class="events-tab" aria-label="事件记录">
    <p v-if="root === null" class="events-tab__empty">未加载文档。</p>
    <p v-else-if="nodes.length === 0" class="events-tab__empty">
      当前脚本没有事件记录。事件记录在片段的事件对象中；本页只编辑已有记录。
    </p>

    <div v-else class="events-tab__layout">
      <aside class="events-tab__list" role="listbox" aria-label="事件记录列表">
        <section v-for="group in trackGroups" :key="group.trackType" class="events-tab__track">
          <header class="events-tab__track-title">
            {{ groupTitle(group.trackType) }}
            <span class="events-tab__track-count">
              {{ group.clips.reduce((sum, clip) => sum + clip.nodes.length, 0) }} 条
            </span>
          </header>
          <div v-for="clip in group.clips" :key="clip.clipKey" class="events-tab__clip">
            <header class="events-tab__clip-head">
              <span class="events-tab__clip-label">{{ clip.label }}</span>
              <button
                type="button"
                class="events-tab__locate"
                :title="`定位到片段 ${clip.label}`"
                @click="openClip(clip.registryKey)"
              >
                定位到片段
              </button>
            </header>
            <button
              v-for="node in clip.nodes"
              :key="nodeKey(node)"
              type="button"
              role="option"
              class="events-tab__item"
              :class="{ 'events-tab__item--active': isActive(node) }"
              :aria-selected="isActive(node)"
              @click="selectNode(node)"
            >
              <span class="events-tab__item-time">t={{ Number.isFinite(node.time) ? node.time.toFixed(3) : '—' }}</span>
              <span class="events-tab__item-summary">{{ describe(node) }}</span>
              <span v-if="problemCount(node) > 0" class="events-tab__item-badge">
                {{ problemCount(node) }} 个问题
              </span>
            </button>
          </div>
        </section>
      </aside>

      <div class="events-tab__detail">
        <EventRecordDetail
          v-if="selectedNode !== undefined && selectedDetailNode !== undefined"
          :key="nodeKey(selectedNode)"
          :node="selectedDetailNode"
          :objects="selectedObjects"
          :clip-ctx="clipInfo.get(selectedRegistryKey ?? '')?.ctx ?? { clipStartTime: 0, duration: 0, infinite: false }"
          :sibling-count="siblingCounts.get(siblingKey(selectedNode)) ?? 1"
        />
        <p v-else class="events-tab__empty">请选择左侧一条事件记录。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.events-tab {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 8px 10px 12px;
  background: var(--bg-app);
  color: var(--text);
  font-size: 12px;
}

.events-tab__empty {
  margin: 0;
  color: var(--text-muted);
}

.events-tab__layout {
  display: grid;
  grid-template-columns: minmax(220px, 42%) minmax(260px, 1fr);
  gap: 10px;
  min-height: 0;
  flex: 1;
}

.events-tab__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  min-height: 0;
}

.events-tab__track {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.events-tab__track-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  color: var(--text-secondary);
  font-weight: 600;
}

.events-tab__track-count {
  color: var(--text-muted);
  font-weight: 400;
}

.events-tab__clip {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 8px;
}

.events-tab__clip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.events-tab__clip-label {
  color: var(--text-secondary);
  font-size: 11px;
}

.events-tab__locate {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.events-tab__locate:hover {
  background: var(--bg-hover);
}

.events-tab__item {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  width: 100%;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.events-tab__item:hover {
  background: var(--bg-hover);
}

.events-tab__item--active {
  border-color: var(--focus);
  background: var(--bg-selected);
}

.events-tab__item-time {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-secondary);
}

.events-tab__item-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.events-tab__item-badge {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--error-bg);
  color: var(--error);
  font-size: 10px;
}

.events-tab__detail {
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
}
</style>
