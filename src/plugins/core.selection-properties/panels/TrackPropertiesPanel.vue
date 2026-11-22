<script setup lang="ts">
/**
 * 轨道参数（检查器改版）：轨道头显式选中 `domain: 'track'` 时显示。
 *
 * 三按钮只改会话 `trackView`（`documentService.setTrackView`，不写脚本）；重命名走
 * `timeline.renameTrack`，一次提交一条撤销项。第三方轨道名沿用只读规则。
 * 没有可用轨道时给安全空态，不把「活动轨道 fallback」当成用户选择。
 */
import { computed, ref, watch } from 'vue'
import type { CommitOutcome, TrackSessionView, TrackViewEntry } from '../../../workbench/api/documents.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { isBuiltinTrackType, trackLabel } from '../../core.timeline/model.ts'
import { usePanelRevision } from '../usePanelRevision.ts'

const DEFAULT_TRACK_SESSION: TrackSessionView = { visible: true, locked: false, muted: false }

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const catalog = ctx.services.get(CATALOG_SERVICE)

const trackId = computed<string | null>(() => {
  void revision.value
  return ctx.selection.domain === 'track' ? (ctx.selection.trackId ?? null) : null
})

const view = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

const session = computed(() => {
  void revision.value
  return documentService?.sessionView() ?? null
})

const track = computed<TrackViewEntry | null>(() => {
  const id = trackId.value
  if (id === null) {
    return null
  }
  return view.value?.tracks.find((entry) => entry.trackId === id) ?? null
})

const trackSession = computed<TrackSessionView>(() => {
  const id = trackId.value
  if (id === null) {
    return DEFAULT_TRACK_SESSION
  }
  return session.value?.trackView[id] ?? DEFAULT_TRACK_SESSION
})

const known = computed(() => {
  if (track.value === null) {
    return true
  }
  return isBuiltinTrackType(track.value.type) || catalog?.track(track.value.type) !== undefined
})

const typeLabel = computed(() => {
  if (track.value === null) {
    return ''
  }
  return trackLabel(track.value.type, known.value)
})

const displayName = computed(() => {
  if (track.value === null) {
    return '未选择轨道'
  }
  const name = track.value.name.trim()
  return name.length > 0 ? name : typeLabel.value
})

/** 与时间轴 `TrackHeader` 同一只读规则：命名空间轨道（含 `:`）不写脚本。 */
const canRename = computed(() => track.value !== null && !track.value.type.includes(':'))

const renameDraft = ref('')
const renameError = ref('')

watch(
  () => `${trackId.value ?? ''}:${track.value?.name ?? ''}`,
  () => {
    renameDraft.value = track.value?.name ?? ''
    renameError.value = ''
  },
  { immediate: true },
)

function commitRename(): CommitOutcome | null {
  const current = track.value
  if (current === null) {
    return null
  }
  const name = renameDraft.value.trim()
  if (name.length === 0) {
    renameError.value = '轨道名不能为空。'
    return null
  }
  const outcome = ctx.commands.commit({ kind: 'timeline.renameTrack', trackId: current.trackId, name })
  renameError.value = outcome.ok ? '' : (outcome.error ?? '重命名被拒绝。')
  return outcome
}

function onRenameKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename()
  }
}

function setVisible(): void {
  const id = trackId.value
  if (id === null) return
  documentService?.setTrackView(id, { visible: !trackSession.value.visible })
}

function setLocked(): void {
  const id = trackId.value
  if (id === null) return
  documentService?.setTrackView(id, { locked: !trackSession.value.locked })
}

function setMuted(): void {
  const id = trackId.value
  if (id === null) return
  documentService?.setTrackView(id, { muted: !trackSession.value.muted })
}

function focusTimeline(): void {
  ctx.requestFocus('timeline.main')
}

function backToScript(): void {
  ctx.requestSelect({ domain: 'none' })
}
</script>

<template>
  <section class="track-panel" aria-label="轨道参数">
    <header class="track-panel__header">
      <h2 class="track-panel__title">轨道参数</h2>
      <span v-if="track !== null" class="track-panel__name" :title="displayName">{{ displayName }}</span>
    </header>

    <p v-if="documentService === undefined" class="track-panel__notice" role="alert">
      文档服务不可用：面板无法读取轨道。
    </p>

    <p v-else-if="view === null" class="track-panel__empty">
      没有打开的脚本。从脚本页打开脚本后，点轨道头查看轨道参数。
    </p>

    <div v-else-if="track === null" class="track-panel__fallback" role="status">
      <p class="track-panel__fallback-title">所选轨道已不存在</p>
      <p class="track-panel__fallback-hint">它可能已被删除、撤销或重排。回到脚本参数，或在时间轴上重新点轨道头。</p>
      <button type="button" class="track-panel__button" @click="backToScript">回到脚本参数</button>
    </div>

    <div v-else class="track-panel__scroll">
      <section class="track-group">
        <h3 class="track-group__title">轨道信息</h3>
        <div class="track-group__body">
          <div class="track-row" :title="track.type">
            <span class="track-row__label">类型</span>
            <span class="track-row__value">{{ typeLabel }}</span>
          </div>

          <div class="track-row">
            <span class="track-row__label">片段</span>
            <span class="track-row__value">{{ track.clips.length }} 个</span>
          </div>

          <div class="track-row track-row--stack">
            <span class="track-row__label">轨道名称</span>
            <div class="track-row__control">
              <template v-if="canRename">
                <input
                  v-model="renameDraft"
                  class="track-panel__input"
                  type="text"
                  maxlength="64"
                  aria-label="轨道名称"
                  @keydown="onRenameKeydown"
                >
                <button type="button" class="track-panel__button" @click="commitRename">重命名</button>
              </template>
              <span v-else class="track-row__value track-row__value--readonly">{{ displayName }}</span>
            </div>
            <p v-if="!canRename" class="track-row__hint">第三方轨道名只读；目录未登记的类型不写脚本。</p>
            <p v-if="renameError !== ''" class="track-row__error" role="alert">{{ renameError }}</p>
          </div>
        </div>
      </section>

      <section class="track-group">
        <h3 class="track-group__title">编辑会话</h3>
        <div class="track-group__body">
          <div class="track-row">
            <span class="track-row__label">可见</span>
            <button
              type="button"
              class="track-panel__toggle"
              :class="{ 'track-panel__toggle--on': trackSession.visible }"
              :aria-pressed="trackSession.visible"
              @click="setVisible"
            >{{ trackSession.visible ? '可见' : '隐藏' }}</button>
          </div>
          <div class="track-row">
            <span class="track-row__label">锁定</span>
            <button
              type="button"
              class="track-panel__toggle"
              :class="{ 'track-panel__toggle--on': trackSession.locked }"
              :aria-pressed="trackSession.locked"
              @click="setLocked"
            >{{ trackSession.locked ? '已锁定' : '未锁定' }}</button>
          </div>
          <div class="track-row">
            <span class="track-row__label">静音</span>
            <button
              type="button"
              class="track-panel__toggle"
              :class="{ 'track-panel__toggle--on': trackSession.muted }"
              :aria-pressed="trackSession.muted"
              @click="setMuted"
            >{{ trackSession.muted ? '已静音' : '有声' }}</button>
          </div>
          <p class="track-row__hint track-row__hint--full">
            可见、锁定和静音是编辑器的会话状态，不写入脚本；时间轴与这里保持同一份状态。
          </p>
        </div>
      </section>

      <div class="track-panel__actions">
        <button type="button" class="track-panel__button" @click="focusTimeline">在时间轴定位</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.track-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1.4;
}

.track-panel__header {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.track-panel__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.track-panel__name {
  overflow: hidden;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-panel__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-bottom: 10px;
}

.track-group + .track-group {
  margin-top: 10px;
}

.track-group__title {
  margin: 0;
  padding: 4px 10px;
  border-block: 1px solid var(--border);
  background: var(--bg-raised);
  font-size: 12px;
  font-weight: 600;
}

.track-group__body {
  display: flex;
  flex-direction: column;
}

.track-row {
  display: grid;
  grid-template-columns: minmax(92px, 116px) minmax(0, 1fr);
  align-items: center;
  gap: 3px 8px;
  min-height: 34px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
}

.track-row--stack {
  align-items: start;
}

.track-row__label {
  color: var(--text-secondary);
  font-weight: 500;
}

.track-row__value {
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-row__value--readonly {
  color: var(--text-secondary);
}

.track-row__control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}

.track-row__hint {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 10px;
  color: var(--text-muted);
}

.track-row__hint--full {
  padding: 5px 10px;
}

.track-row__error {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--error);
  font-size: 10px;
}

.track-panel__input {
  width: min(220px, 100%);
  box-sizing: border-box;
  padding: 3px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font: inherit;
}

.track-panel__input:focus-visible,
.track-panel__button:focus-visible,
.track-panel__toggle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.track-panel__button {
  padding: 2px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.track-panel__button:hover {
  background: var(--bg-hover);
}

.track-panel__toggle {
  min-width: 72px;
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.track-panel__toggle--on {
  border-color: var(--accent);
  background: var(--bg-selected);
  color: var(--text);
}

.track-panel__toggle:hover {
  background: var(--bg-hover);
}

.track-panel__actions {
  display: flex;
  justify-content: flex-end;
  padding: 7px 10px;
}

.track-panel__empty,
.track-panel__notice,
.track-panel__fallback {
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.track-panel__notice {
  border-color: var(--error);
  background: var(--bg-raised);
}

.track-panel__fallback-title {
  margin: 0 0 4px;
  color: var(--text);
  font-weight: 600;
}

.track-panel__fallback-hint {
  margin: 0 0 8px;
  font-size: 11px;
}
</style>
