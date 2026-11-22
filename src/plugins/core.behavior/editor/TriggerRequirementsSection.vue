<script setup lang="ts">
/**
 * 前置区（11-05）：`requires[]` 独立于条件树。内置前置可换类型 / 目标 / 上下移；
 * 自定义与形态非法条目只读；六态解析、依赖边 / 重复目标 / 悬空桩 / 自引用 / 环内前置现算；
 * 不显示 requiresFingerprint。
 *
 * 所有操作只改弹窗草稿，由外层一次保存统一提交；自定义与形态非法条目保持只读。
 */
import { computed, ref } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { JsonValue } from '../../../core/doc/types.ts'
import { GRAPH_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import type { BuiltinRequirementType } from '../../../core/graph/types.ts'
import { isBuiltinRequirementType } from '../../../core/graph/types.ts'
import { newRequirement, writeRequirement } from '../../../core/graph/requirements.ts'
import {
  BUILTIN_REQUIREMENT_TYPES,
} from '../../../core/schema/catalog/behaviorTriggers.ts'
import {
  requirementCycleMembers,
  requirementEdges,
  requirementEntries,
  resolveRequirement,
} from '../../../features/behavior/requirements.ts'
import type { RequirementEntry } from '../../../features/behavior/trigger.types.ts'
import type { RequirementContext } from '../../../features/behavior/requirements.ts'
import { parseTriggerNode } from '../../../features/behavior/trigger.ts'
import { requirementContext, type PanelScriptContext, type PanelTrigger } from '../panels/triggerPanelModel.ts'

const props = defineProps<{
  row: PanelTrigger | null
  draft: JsonObject
  scriptContext: PanelScriptContext
  meta: JsonObject | null
}>()

const ctx = usePanelContext()

const reqCtx = computed<RequirementContext>(() => requirementContext(props.scriptContext))

const entries = computed<RequirementEntry[]>(() =>
  requirementEntries(props.draft),
)

const resolutions = computed(() =>
  entries.value.map((entry) => resolveRequirement(entry, reqCtx.value)),
)

const draftNode = computed(() => parseTriggerNode(props.draft, props.row?.node.index ?? 0))
const edges = computed(() => requirementEdges(draftNode.value, reqCtx.value))

const cycleMembers = computed(() =>
  requirementCycleMembers([draftNode.value], reqCtx.value),
)

interface TargetOption {
  scriptId: string
  label: string
  path: string
}

const targetOptions = computed<TargetOption[]>(() => {
  const graph = ctx.services.get(GRAPH_SERVICE)?.current()
  if (graph === null || graph === undefined) return []
  return graph.nodes
    .filter((node) => typeof node.scriptId === 'string' && node.scriptId.length > 0)
    .map((node) => ({ scriptId: node.scriptId as string, label: node.name || node.scriptId as string, path: node.path }))
})

const STATUS_LABEL: Record<string, string> = {
  resolved: '已解析',
  missing: '目标缺失',
  self_reference: '自引用',
  duplicate_id_unresolved: 'id 重复',
  malformed: '形态非法',
  custom: '自定义只读',
}

const addType = ref<BuiltinRequirementType>('script_played')
const addTarget = ref('')
const editTargets = ref<Record<number, string>>({})

function edgeFor(index: number) {
  return edges.value.find((edge) => resolutions.value[index]?.entry === edge.entry)
}

function targetFor(index: number): string {
  if (editTargets.value[index] !== undefined) return editTargets.value[index]
  return resolutions.value[index]?.targetScriptId ?? ''
}

function pathFor(target: string | undefined): string | undefined {
  if (target === undefined) return undefined
  return targetOptions.value.find((option) => option.scriptId === target)?.path
}

function setEditTarget(index: number, value: string): void {
  editTargets.value[index] = value
}

/** 命令层可写：内置条目；自定义 / 形态非法只读。 */
function editable(index: number): boolean {
  const resolution = resolutions.value[index]
  if (resolution === undefined) return false
  return resolution.status !== 'custom' && resolution.status !== 'malformed'
}

function entryBuiltinType(index: number): BuiltinRequirementType | null {
  const entry = entries.value[index]
  if (entry === undefined) return null
  if (entry.kind === 'string') return 'script_played'
  if (entry.kind === 'object' && isBuiltinRequirementType(entry.type)) return entry.type
  return null
}

function builtinOptions(): readonly BuiltinRequirementType[] {
  return BUILTIN_REQUIREMENT_TYPES.map((entry) => entry.type as BuiltinRequirementType)
}

function writeEntries(next: JsonValue[]): void {
  if (next.length === 0) delete props.draft.requires
  else props.draft.requires = next
}

function addRequirement(): void {
  const target = addTarget.value.trim()
  if (target === '') return
  const next = entries.value.map((entry) => entry.raw)
  next.push(newRequirement(addType.value, target))
  writeEntries(next)
  addTarget.value = ''
}

function updateRequirement(index: number, type: BuiltinRequirementType): void {
  const target = targetFor(index).trim()
  if (target === '') return
  const next = entries.value.map((entry) => entry.raw)
  next[index] = writeRequirement(next[index], type, target)
  writeEntries(next)
  delete editTargets.value[index]
}

function removeRequirement(index: number): void {
  const next = entries.value.map((entry) => entry.raw)
  next.splice(index, 1)
  writeEntries(next)
}

function moveRequirement(index: number, dir: -1 | 1): void {
  const to = index + dir
  if (to < 0 || to >= entries.value.length) return
  const next = entries.value.map((entry) => entry.raw)
  const [moved] = next.splice(index, 1)
  next.splice(to, 0, moved)
  writeEntries(next)
}

function entryTypeLabel(entry: RequirementEntry): string {
  if (entry.kind === 'string') return 'script_played（简写）'
  if (entry.kind === 'object') return entry.type || '（空 type）'
  return '形态非法'
}

function rawDump(entry: RequirementEntry): string {
  return JSON.stringify(entry.raw)
}

void props.meta
</script>

<template>
  <section class="requirements" aria-label="前置条件">
    <h3 class="section-title">前置条件</h3>

    <div v-if="entries.length === 0" class="requirements__empty">没有前置条目</div>

    <ul v-else class="requirements__list">
      <li v-for="(entry, index) in entries" :key="index" class="requirements__item">
        <div class="requirements__head">
          <span class="requirements__type">{{ entryTypeLabel(entry) }}</span>
          <span class="requirements__status" :data-status="resolutions[index].status">
            {{ STATUS_LABEL[resolutions[index].status] ?? resolutions[index].status }}
          </span>
          <span v-if="edgeFor(index)?.duplicate" class="requirements__flag">重复目标</span>
          <span v-if="resolutions[index].status === 'self_reference'" class="requirements__flag">自引用（不画完整边）</span>
          <span v-if="resolutions[index].targetScriptId && cycleMembers.has(resolutions[index].targetScriptId)" class="requirements__flag">环内前置</span>
          <span v-if="resolutions[index].status === 'missing'" class="requirements__flag">悬空桩</span>
        </div>

        <div class="requirements__target">
          <template v-if="!editable(index)">
            <span class="requirements__readonly">只读：{{ rawDump(entry) }}</span>
          </template>
          <template v-else>
            <select
              v-if="entry.kind !== 'string'"
              class="requirements__select"
              :value="entryBuiltinType(index) ?? 'script_played'"
              @change="updateRequirement(index, ($event.target as HTMLSelectElement).value as BuiltinRequirementType)"
            >
              <option v-for="type in builtinOptions()" :key="type" :value="type">{{ type }}</option>
            </select>
            <input
              class="requirements__input"
              :value="targetFor(index)"
              placeholder="目标脚本 id"
              @input="setEditTarget(index, ($event.target as HTMLInputElement).value)"
            />
            <span class="requirements__path">{{ pathFor(resolutions[index].targetScriptId) ?? '' }}</span>
            <button
              type="button"
              class="requirements__button"
              :disabled="targetFor(index).trim() === ''"
              @click="updateRequirement(index, entryBuiltinType(index) ?? 'script_played')"
            >
              保存
            </button>
            <span class="requirements__ops">
              <button
                type="button"
                class="requirements__button"
                :disabled="index === 0"
                @click="moveRequirement(index, -1)"
                title="上移"
              >
                ↑
              </button>
              <button
                type="button"
                class="requirements__button"
                :disabled="index === entries.length - 1"
                @click="moveRequirement(index, 1)"
                title="下移"
              >
                ↓
              </button>
              <button type="button" class="requirements__button" @click="removeRequirement(index)">删除</button>
            </span>
          </template>
        </div>

        <p v-if="resolutions[index].message" class="requirements__note">{{ resolutions[index].message }}</p>
      </li>
    </ul>

    <div class="requirements__add">
      <select v-model="addType" class="requirements__select">
        <option v-for="type in builtinOptions()" :key="type" :value="type">{{ type }}</option>
      </select>
      <input
        v-model="addTarget"
        class="requirements__input"
        list="prereq-targets"
        placeholder="目标脚本 id（可手输）"
      />
      <datalist id="prereq-targets">
        <option v-for="option in targetOptions" :key="option.scriptId" :value="option.scriptId">
          {{ option.label }}
        </option>
      </datalist>
      <button type="button" :disabled="addTarget.trim() === ''" @click="addRequirement">添加前置</button>
    </div>

  </section>
</template>

<style scoped>
.requirements {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
}

.section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.requirements__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.requirements__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
}

.requirements__head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}

.requirements__type {
  font-weight: 600;
}

.requirements__status[data-status='missing'],
.requirements__status[data-status='malformed'] {
  color: var(--error, #e05555);
}

.requirements__status[data-status='self_reference'],
.requirements__status[data-status='duplicate_id_unresolved'] {
  color: var(--warning, #e0a555);
}

.requirements__status[data-status='resolved'] {
  color: var(--ok, #55b06a);
}

.requirements__flag {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--accent-bg, #2b4a66);
  color: var(--accent, #4a90d9);
}

.requirements__target {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.requirements__ops {
  display: flex;
  gap: 4px;
}

.requirements__select,
.requirements__input {
  font: inherit;
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--panel-bg, #1c1c1c);
  color: var(--text, #eee);
}

.requirements__button {
  font: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--panel-bg, #222);
  color: var(--text, #eee);
  cursor: pointer;
}

.requirements__button:disabled {
  opacity: 0.4;
}

.requirements__path {
  font-size: 10px;
  color: var(--text-muted, #999);
}

.requirements__readonly {
  font-size: 11px;
  color: var(--text-muted, #999);
}

.requirements__note {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted, #999);
}

.requirements__add {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.requirements__differences {
  font-size: 11px;
  color: var(--text-muted, #999);
}

.requirements__differences ul {
  margin: 4px 0 0;
  padding-left: 16px;
}

.requirements__empty {
  font-size: 11px;
  color: var(--text-muted, #999);
}
</style>
