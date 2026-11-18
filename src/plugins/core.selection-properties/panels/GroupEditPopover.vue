<script setup lang="ts">
/**
 * 组合编辑弹层（07-01）：成员表 + 四动作 + 批量改值行内编辑 + 自定义组 CRUD。
 *
 * 只渲染与事件转发；计划 / 计数 / 补齐 / CRUD 都走 `groupPopover.ts` 纯函数。
 * 命令经 `apply` 交父面板 commit；组合定义变更经 `groups-change` 交父面板写 service。
 */
import { computed, ref, watch } from 'vue'
import type { CatalogIndex } from '../../../core/schema/index.ts'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import type { AuthoringGroup, GroupAction, GroupActionPlan } from '../../../features/authoring/groups.ts'
import {
  matchAuthoringGroup,
  planGroupPopover,
  planToCompoundCommand,
  canDeleteGroup,
  createCustomGroup,
  renameGroup,
  addGroupMembers,
  removeGroupMembers,
  deleteGroup,
  rowPaths,
} from '../../../features/authoring/ui/groupPopover.ts'
import type { ApplyItem } from '../../../features/authoring/ui/positionFields.ts'

const props = defineProps<{
  /** 合并注册表：配置组 + 自定义组。 */
  groups: AuthoringGroup[]
  activeGroupKey: string | null
  rows: PropertyRow[]
  clipKey: string
  objects: JsonObject
  trackType: string
  catalog: CatalogIndex
  time: number
}>()

const emit = defineEmits<{
  apply: [items: ApplyItem[]]
  'groups-change': [groups: AuthoringGroup[]]
}>()

const ACTIONS: Array<{ action: GroupAction; label: string }> = [
  { action: 'create', label: '同刻建帧' },
  { action: 'capture', label: '抓取当前值' },
  { action: 'set-values', label: '批量改值' },
  { action: 'remove', label: '删除该时刻帧' },
]

const activeGroup = computed<AuthoringGroup | null>(() => {
  if (props.activeGroupKey === null) {
    return null
  }
  return props.groups.find((group) => group.id === props.activeGroupKey) ?? null
})

const match = computed(() => matchAuthoringGroup(rowPaths(props.rows), { groups: props.groups, errors: [] }))

const selectedAction = ref<GroupAction>('create')
/** 批量改值的行内草稿：path → 文本。 */
const valueDrafts = ref<Record<string, string>>({})
const editingPath = ref<string | null>(null)

const pendingFill = ref<{ action: GroupAction; missingAxes: string[]; warning: string } | null>(null)

const plan = computed<GroupActionPlan | null>(() => {
  const group = activeGroup.value
  if (group === null) {
    return null
  }
  return planGroupPopover({
    catalog: props.catalog,
    clip: { objects: props.objects },
    trackType: props.trackType,
    group,
    time: props.time,
    action: selectedAction.value,
    ...(selectedAction.value === 'set-values' ? { values: draftValues() } : {}),
    fillAxes: false,
  })
})

function draftValues(): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {}
  for (const row of props.rows) {
    const text = valueDrafts.value[row.path]
    if (text === undefined) {
      continue
    }
    result[row.path] = coerceValue(row, text)
  }
  return result
}

function coerceValue(row: PropertyRow, text: string): JsonValue {
  if (row.type === 'boolean') {
    return text === 'true' || text === 'on' || text === '1'
  }
  if (row.type === 'number' || row.type === 'integer' || row.type === 'nullable_float') {
    const number = Number(text)
    return Number.isFinite(number) ? number : text
  }
  return text
}

function runAction(action: GroupAction): void {
  selectedAction.value = action
  const current = plan.value
  if (current === null) {
    return
  }
  if (current.missingAxes.length > 0) {
    pendingFill.value = { action, missingAxes: current.missingAxes, warning: current.warnings[0] ?? '' }
    return
  }
  pendingFill.value = null
  submitPlan(current)
}

function resubmitWithFill(): void {
  const group = activeGroup.value
  if (group === null) {
    return
  }
  const next = planGroupPopover({
    catalog: props.catalog,
    clip: { objects: props.objects },
    trackType: props.trackType,
    group,
    time: props.time,
    action: pendingFill.value?.action ?? selectedAction.value,
    ...(selectedAction.value === 'set-values' ? { values: draftValues() } : {}),
    fillAxes: true,
  })
  pendingFill.value = null
  submitPlan(next)
}

function cancelFill(): void {
  pendingFill.value = null
}

function submitPlan(current: GroupActionPlan): void {
  const command = planToCompoundCommand(props.clipKey, current)
  if (command === null) {
    return
  }
  emit('apply', [{ command, successText: `组合动作「${actionLabel(selectedAction.value)}」已提交` }])
}

function actionLabel(action: GroupAction): string {
  return ACTIONS.find((item) => item.action === action)?.label ?? action
}

// ── 行内编辑（Enter 提交 / Esc 取消） ────────────────────────────────────────

function startEdit(row: PropertyRow): void {
  editingPath.value = row.path
  if (valueDrafts.value[row.path] === undefined) {
    valueDrafts.value[row.path] = row.value === undefined || row.value === null ? '' : String(row.value)
  }
}

function commitEdit(row: PropertyRow): void {
  editingPath.value = null
  if (selectedAction.value !== 'set-values') {
    selectedAction.value = 'set-values'
  }
}

function cancelEdit(): void {
  editingPath.value = null
}

function onEditKeydown(row: PropertyRow, event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitEdit(row)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelEdit()
  }
}

// ── 自定义组 CRUD（本地纯数据变换；结果经 groups-change 上交） ────────────────

const workingGroups = ref<AuthoringGroup[]>([...props.groups])
watch(() => props.groups, (next) => {
  workingGroups.value = [...next]
})

const hiddenIds = ref<Set<string>>(new Set())
const newGroupName = ref('')
const memberPick = ref<Record<string, string>>({})
const renamingId = ref<string | null>(null)
const renameText = ref('')

function toggleHidden(id: string): void {
  const next = new Set(hiddenIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  hiddenIds.value = next
}

function emitGroups(): void {
  emit('groups-change', workingGroups.value)
}

function candidatesFor(group: AuthoringGroup): PropertyRow[] {
  return props.rows.filter((row) => !group.members.includes(row.path))
}

function createGroup(): void {
  const draft = createCustomGroup(
    workingGroups.value,
    { name: newGroupName.value, track: props.trackType, members: rowPaths(props.rows) },
    props.catalog,
  )
  if ('error' in draft) {
    return
  }
  workingGroups.value = draft.groups
  newGroupName.value = ''
  emitGroups()
}

function startRename(group: AuthoringGroup): void {
  renamingId.value = group.id
  renameText.value = group.name
}

function commitRename(id: string): void {
  const next = renameGroup(workingGroups.value, id, renameText.value)
  if (next === null) {
    return
  }
  workingGroups.value = next
  renamingId.value = null
  renameText.value = ''
  emitGroups()
}

function cancelRename(): void {
  renamingId.value = null
  renameText.value = ''
}

function addMember(id: string): void {
  const path = memberPick.value[id]
  if (path === undefined || path === '') {
    return
  }
  const next = addGroupMembers(workingGroups.value, id, [path], props.catalog)
  if (next.error !== undefined) {
    return
  }
  workingGroups.value = next.groups
  memberPick.value = { ...memberPick.value, [id]: '' }
  emitGroups()
}

function removeMember(id: string, member: string): void {
  const next = removeGroupMembers(workingGroups.value, id, [member])
  if (next === null) {
    return
  }
  workingGroups.value = next
  emitGroups()
}

function removeGroup(id: string): void {
  const next = deleteGroup(workingGroups.value, id)
  if (next === null) {
    return
  }
  workingGroups.value = next
  emitGroups()
}

function rowOf(path: string): PropertyRow {
  return props.rows.find((row) => row.path === path) ?? props.rows[0]
}
</script>

<template>
  <div class="popover">
    <p class="popover__hint">
      {{ match.group === null ? '未命中内置组合，可另建自定义组合' : `命中内置组合：${match.group.name}（交集 ${match.intersection}）` }}
    </p>

    <div class="popover__actions">
      <button
        v-for="item in ACTIONS"
        :key="item.action"
        type="button"
        class="popover__button"
        :class="{ 'popover__button--active': selectedAction === item.action }"
        @click="runAction(item.action)"
      >
        {{ item.label }}
      </button>
      <span v-if="plan !== null" class="popover__counts">
        将建 {{ plan.counts.create }} · 已有 {{ plan.counts.existing }} · 跳过 {{ plan.counts.skip }}
      </span>
    </div>

    <table v-if="plan !== null" class="popover__table">
      <thead>
        <tr>
          <th>路径</th>
          <th>当前值</th>
          <th>帧数</th>
          <th>归属</th>
          <th>动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="member in plan.members"
          :key="member.path"
          :class="{ 'popover__row--blocked': member.state === 'requires-blocked' || member.state === 'static' || member.state === 'event' }"
        >
          <td class="popover__path" :title="member.state === 'requires-blocked' ? '依赖未满足' : ''">{{ member.path }}</td>
          <td>
            <input
              v-if="selectedAction === 'set-values' && editingPath === member.path"
              class="popover__edit"
              type="text"
              :value="valueDrafts[member.path] ?? member.value"
              @input="valueDrafts[member.path] = ($event.target as HTMLInputElement).value"
              @keydown="onEditKeydown(rowOf(member.path), $event)"
              @blur="commitEdit(rowOf(member.path))"
            />
            <span v-else class="popover__value">{{ member.value }}</span>
          </td>
          <td class="popover__count">{{ member.frameCount }}</td>
          <td class="popover__panel">{{ member.panel === 'effects' ? '效果面板' : '属性面板' }}</td>
          <td class="popover__action">{{ member.action }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="pendingFill !== null" class="popover__confirm" role="alertdialog">
      <p class="popover__note">{{ pendingFill.warning }}</p>
      <button type="button" class="popover__button" @click="resubmitWithFill">补齐三轴并提交</button>
      <button type="button" class="popover__button" @click="cancelFill">取消</button>
    </div>

    <div class="popover__groups">
      <h3 class="popover__subhead">组合定义</h3>
      <div v-for="group in workingGroups" :key="group.id" class="popover__group">
        <div class="popover__group-head">
          <template v-if="renamingId === group.id">
            <input
              v-model="renameText"
              type="text"
              class="popover__edit"
              @keydown.enter.prevent="commitRename(group.id)"
              @keydown.esc.prevent="cancelRename"
            />
            <button type="button" class="popover__link" @click="commitRename(group.id)">保存</button>
            <button type="button" class="popover__link" @click="cancelRename">取消</button>
          </template>
          <template v-else>
            <span class="popover__group-name">{{ group.name }}</span>
            <span class="popover__badge">{{ group.builtin ? '内置' : '自定义' }}</span>
            <button
              v-if="group.builtin"
              type="button"
              class="popover__link"
              @click="toggleHidden(group.id)"
            >
              {{ hiddenIds.has(group.id) ? '恢复显示' : '临时隐藏' }}
            </button>
            <template v-else>
              <button type="button" class="popover__link" @click="startRename(group)">改名</button>
              <button type="button" class="popover__link" @click="removeGroup(group.id)">删除</button>
            </template>
          </template>
        </div>
        <ul class="popover__members">
          <li v-for="member in group.members" :key="member" class="popover__member">
            <span class="popover__path">{{ member }}</span>
            <button
              v-if="canDeleteGroup(group)"
              type="button"
              class="popover__link"
              @click="removeMember(group.id, member)"
            >移除</button>
          </li>
        </ul>
        <div v-if="canDeleteGroup(group)" class="popover__add">
          <select v-model="memberPick[group.id]">
            <option value="">选择成员</option>
            <option v-for="candidate in candidatesFor(group)" :key="candidate.path" :value="candidate.path">
              {{ candidate.label }}
            </option>
          </select>
          <button type="button" class="popover__button" @click="addMember(group.id)">加成员</button>
        </div>
      </div>

      <div class="popover__create">
        <input v-model="newGroupName" type="text" class="popover__edit" placeholder="新组合名称" />
        <button type="button" class="popover__button" @click="createGroup">新建自定义组合</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.popover {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 320px;
  padding: 10px;
  color: var(--text);
  font-size: 11px;
}

.popover__hint,
.popover__note {
  margin: 0;
  color: var(--text-muted);
}

.popover__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.popover__button {
  padding: 1px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.popover__button--active {
  border-color: var(--accent);
  color: var(--accent);
}

.popover__link {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
}

.popover__counts {
  margin-left: auto;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.popover__table {
  width: 100%;
  border-collapse: collapse;
}

.popover__table th,
.popover__table td {
  padding: 2px 6px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.popover__path {
  font-family: var(--font-mono);
  font-size: 11px;
}

.popover__value,
.popover__count,
.popover__panel,
.popover__action {
  color: var(--text-secondary);
}

.popover__edit {
  width: 100%;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
}

.popover__confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--warning);
  border-radius: 4px;
  background: var(--bg-raised);
}

.popover__groups {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.popover__subhead {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
}

.popover__group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.popover__group-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.popover__group-name {
  font-weight: 500;
}

.popover__badge {
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  color: var(--text-muted);
  font-size: 10px;
}

.popover__members {
  margin: 0;
  padding-left: 14px;
}

.popover__member {
  display: flex;
  align-items: center;
  gap: 6px;
}

.popover__add,
.popover__create {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
