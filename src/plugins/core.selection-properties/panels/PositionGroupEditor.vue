<script setup lang="ts">
/**
 * 位置组控制条（07-02）：组头下方一栏紧凑显示模式 / 空间 / 原点 / 冻结 / 方向源分支。
 *
 * 三轴值行由组内行组件渲染，本组件不重复列值行；只渲染控制条与「不读取」标注，
 * 命令通过 `apply` 事件交父面板统一 commit。
 */
import { computed, shallowRef } from 'vue'
import type { CatalogIndex } from '../../../core/schema/index.ts'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import {
  projectPositionBar,
  planPositionStepWrite,
  planClearIgnoredAbsolute,
  planSimpleWrite,
  staticField,
  type ApplyItem,
} from '../../../features/authoring/ui/positionFields.ts'
import {
  draftPointSource,
  validatePointDraft,
  facingAutoState,
  type CoordTriple,
  type PointSourceDraft,
} from '../../../features/authoring/ui/pointSourceFields.ts'
import PointSourceForm from './PointSourceForm.vue'

const props = defineProps<{
  clipKey: string
  objects: JsonObject
  trackType: string
  catalog: CatalogIndex
  time: number
  /** 该组在效果面板的叶子数（0 表示整组都在属性面板）。 */
  effectCount?: number
}>()

const emit = defineEmits<{
  apply: [items: ApplyItem[]]
}>()

const bar = computed(() => projectPositionBar(props.objects))

/** step 缺三轴时的两步确认：先拦住，作者选「补齐三轴并提交」再合并同一 commit。 */
// `shallowRef`：对象内含递归 `JsonValue`，`ref` 的深解包会触发 TS2589；整体替换语义不变。
const pendingFill = shallowRef<{ path: string; value: JsonValue; missingAxes: string[]; warning: string } | null>(null)

const originDraft = computed<PointSourceDraft>(() => draftPointSource(
  staticField(props.objects, 'position_origin', ''),
  { x: staticField(props.objects, 'position_origin_x', null), y: staticField(props.objects, 'position_origin_y', null), z: staticField(props.objects, 'position_origin_z', null) },
))
const targetDraft = computed<PointSourceDraft>(() => draftPointSource(
  staticField(props.objects, 'facing_target', ''),
  { x: staticField(props.objects, 'facing_target_x', null), y: staticField(props.objects, 'facing_target_y', null), z: staticField(props.objects, 'facing_target_z', null) },
))
const entityDraft = computed<PointSourceDraft>(() => draftPointSource(
  staticField(props.objects, 'facing_entity', ''),
  {},
))

function emitApply(commands: DocCommand[], successText: string): void {
  if (commands.length === 0) {
    return
  }
  emit('apply', commands.map((command) => ({ command, successText })))
}

function onStepChange(path: string, value: JsonValue): void {
  const plan = planPositionStepWrite({
    clip: props.objects,
    catalog: props.catalog,
    trackType: props.trackType,
    clipKey: props.clipKey,
    path,
    time: props.time,
    value,
    fillAxes: false,
  })
  if (plan.blocked) {
    pendingFill.value = { path, value, missingAxes: plan.missingAxes, warning: plan.warnings[0] ?? '' }
    return
  }
  pendingFill.value = null
  emitApply(plan.commands, `已切换 ${path}`)
}

function confirmFill(): void {
  const pending = pendingFill.value
  if (pending === null) {
    return
  }
  const plan = planPositionStepWrite({
    clip: props.objects,
    catalog: props.catalog,
    trackType: props.trackType,
    clipKey: props.clipKey,
    path: pending.path,
    time: props.time,
    value: pending.value,
    fillAxes: true,
  })
  pendingFill.value = null
  if (!plan.blocked) {
    emitApply(plan.commands, '已补齐三轴并提交')
  }
}

function cancelFill(): void {
  pendingFill.value = null
}

const COORD_KEYS = ['x', 'y', 'z'] as const

function coordCommands(prefix: string, coords: CoordTriple): DocCommand[] {
  return coords.map((value, index) => planSimpleWrite(
    props.clipKey,
    props.objects,
    `${prefix}_${COORD_KEYS[index]}`,
    props.time,
    value,
  ))
}

function onOriginDraft(draft: PointSourceDraft): void {
  const validation = validatePointDraft('position_origin', draft)
  if (!validation.ok || validation.ref === null) {
    return
  }
  const commands: DocCommand[] = [planSimpleWrite(props.clipKey, props.objects, 'position_origin', props.time, validation.ref)]
  if (draft.kind === 'coordinate') {
    commands.push(...coordCommands('position_origin', draft.coords))
  }
  emitApply(commands, '已更新位置原点')
}

function onTargetDraft(draft: PointSourceDraft): void {
  if (autoConflict.value) {
    return
  }
  const validation = validatePointDraft('facing_target', draft)
  if (!validation.ok || validation.ref === null) {
    return
  }
  const commands: DocCommand[] = [planSimpleWrite(props.clipKey, props.objects, 'facing_target', props.time, validation.ref)]
  if (draft.kind === 'coordinate') {
    commands.push(...coordCommands('facing_target', draft.coords))
  }
  emitApply(commands, '已更新方向目标')
}

function onEntityDraft(draft: PointSourceDraft): void {
  if (autoConflict.value) {
    return
  }
  const validation = validatePointDraft('facing_entity', draft)
  if (!validation.ok || validation.ref === null) {
    return
  }
  emitApply([planSimpleWrite(props.clipKey, props.objects, 'facing_entity', props.time, validation.ref)], '已更新方向实体')
}

function onFreeze(path: string, value: boolean): void {
  emitApply([planSimpleWrite(props.clipKey, props.objects, path, props.time, value)], `已切换 ${path}`)
}

function clearIgnored(): void {
  emitApply(planClearIgnoredAbsolute(props.clipKey, props.objects), '已清除 absolute 下被忽略的原点 / 方向源')
}

const originFreezeChecked = computed(() => staticField(props.objects, 'position_origin_freeze', false) === true)
const targetFreezeChecked = computed(() => staticField(props.objects, 'facing_target_freeze', false) === true)

/** auto 冲突：target 与 entity 同时非空，阻止任一侧继续提交。 */
const autoConflict = computed(() => facingAutoState(
  bar.value.values.facing_target,
  bar.value.values.facing_entity,
  bar.value.branches.originKind,
).conflict)
</script>

<template>
  <div class="pos-editor">
    <div class="pos-editor__summary">{{ bar.visibility.summary }}</div>

    <div class="pos-editor__row">
      <label class="pos-editor__field">
        <span class="pos-editor__label">模式</span>
        <select
          :value="bar.values.position_mode"
          :disabled="false"
          @change="onStepChange('position_mode', ($event.target as HTMLSelectElement).value)"
        >
          <option value="relative">relative</option>
          <option value="absolute">absolute</option>
        </select>
      </label>

      <label class="pos-editor__field">
        <span class="pos-editor__label">空间</span>
        <select
          :value="bar.values.position_space"
          :disabled="!bar.cells['position_space'].enabled"
          :title="bar.cells['position_space'].note"
          @change="onStepChange('position_space', ($event.target as HTMLSelectElement).value)"
        >
          <option value="world">world</option>
          <option value="base">base</option>
        </select>
      </label>

      <span v-if="(effectCount ?? 0) > 0" class="pos-editor__effects">{{ effectCount }} 项在效果面板</span>
    </div>

    <div v-if="bar.cells['position_origin'].visible" class="pos-editor__row">
      <span class="pos-editor__label">原点</span>
      <PointSourceForm
        field="position_origin"
        :draft="originDraft"
        :disabled="!bar.cells['position_origin'].read"
        @update:draft="onOriginDraft"
      />
      <span v-if="!bar.cells['position_origin'].read" class="pos-editor__note">{{ bar.cells['position_origin'].note }}</span>
    </div>

    <label
      v-if="bar.cells['position_origin_freeze'].visible"
      class="pos-editor__row"
      :class="{ 'pos-editor__row--disabled': !bar.cells['position_origin_freeze'].read }"
    >
      <input
        type="checkbox"
        :checked="originFreezeChecked"
        :disabled="!bar.cells['position_origin_freeze'].read"
        @change="onFreeze('position_origin_freeze', ($event.target as HTMLInputElement).checked)"
      />
      <span class="pos-editor__label">原点冻结</span>
      <span v-if="!bar.cells['position_origin_freeze'].read" class="pos-editor__note">{{ bar.cells['position_origin_freeze'].note }}</span>
    </label>

    <template v-if="bar.branches.facingVisible">
      <div class="pos-editor__row">
        <span class="pos-editor__label">方向源</span>
        <select
          :value="bar.values.facing_source"
          @change="onStepChange('facing_source', ($event.target as HTMLSelectElement).value)"
        >
          <option value="auto">auto</option>
          <option value="entity">entity</option>
          <option value="line">line</option>
          <option value="world">world</option>
        </select>
      </div>

      <div v-if="bar.cells['facing_target'].visible" class="pos-editor__row">
        <span class="pos-editor__label">方向目标</span>
        <PointSourceForm
          field="facing_target"
          :draft="targetDraft"
          :disabled="!bar.cells['facing_target'].read"
          @update:draft="onTargetDraft"
        />
        <span v-if="!bar.cells['facing_target'].read" class="pos-editor__note">{{ bar.cells['facing_target'].note }}</span>
      </div>

      <label
        v-if="bar.cells['facing_target_freeze'].visible"
        class="pos-editor__row"
        :class="{ 'pos-editor__row--disabled': !bar.cells['facing_target_freeze'].read }"
      >
        <input
          type="checkbox"
          :checked="targetFreezeChecked"
          :disabled="!bar.cells['facing_target_freeze'].read"
          @change="onFreeze('facing_target_freeze', ($event.target as HTMLInputElement).checked)"
        />
        <span class="pos-editor__label">目标冻结</span>
      </label>

      <div v-if="bar.cells['facing_entity'].visible" class="pos-editor__row">
        <span class="pos-editor__label">方向实体</span>
        <PointSourceForm
          field="facing_entity"
          :draft="entityDraft"
          :disabled="!bar.cells['facing_entity'].read"
          @update:draft="onEntityDraft"
        />
        <span v-if="!bar.cells['facing_entity'].read" class="pos-editor__note">{{ bar.cells['facing_entity'].note }}</span>
      </div>
    </template>

    <div v-if="bar.branches.absolute" class="pos-editor__row">
      <button type="button" class="pos-editor__button" @click="clearIgnored">清除被忽略的原点 / 方向源</button>
      <span class="pos-editor__note">absolute 锁定 world；原点与方向源不参与，值保留可显式清除</span>
    </div>

    <p v-for="warning in bar.warnings" :key="warning" class="pos-editor__warning" role="alert">{{ warning }}</p>

    <div v-if="pendingFill !== null" class="pos-editor__confirm" role="alertdialog">
      <p class="pos-editor__note">{{ pendingFill.warning }}</p>
      <button type="button" class="pos-editor__button" @click="confirmFill">补齐三轴并提交</button>
      <button type="button" class="pos-editor__button" @click="cancelFill">取消</button>
    </div>
  </div>
</template>

<style scoped>
.pos-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 11px;
}

.pos-editor__summary {
  color: var(--text-secondary);
}

.pos-editor__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.pos-editor__row--disabled {
  opacity: 0.55;
}

.pos-editor__field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pos-editor__label {
  color: var(--text-muted);
  white-space: nowrap;
}

.pos-editor__kind,
.pos-editor__field select {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
}

.pos-editor__note {
  color: var(--warning);
  font-size: 11px;
}

.pos-editor__effects {
  margin-left: auto;
  color: var(--accent);
  white-space: nowrap;
}

.pos-editor__button {
  padding: 1px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.pos-editor__button:hover {
  background: var(--bg-hover);
}

.pos-editor__warning {
  margin: 0;
  color: var(--warning);
}

.pos-editor__confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--warning);
  border-radius: 4px;
  background: var(--bg-raised);
}
</style>
