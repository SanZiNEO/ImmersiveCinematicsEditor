<script setup lang="ts">
/**
 * 朝向组控制条（07-04）：优先级链文案 + look_at 注入载荷 + 两基准轴 + 锁 + 切线偏移提示。
 *
 * 三角度值行由组内行组件渲染，本组件不重复列值行；命令通过 `apply` 事件交父面板提交。
 * 角度值不归一化；`orient` 是静态值字段，不进效果面板。
 */
import { computed, ref } from 'vue'
import type { CatalogIndex } from '../../../core/schema/index.ts'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import {
  projectOrientationBar,
  lockNote,
  baseNote,
  type OrientationRuntimeFlags,
} from '../../../features/authoring/ui/orientationFields.ts'
import { planSimpleWrite, staticField, type ApplyItem } from '../../../features/authoring/ui/positionFields.ts'
import {
  draftPointSource,
  draftLookAt,
  validateLookAtDraft,
  type CoordTriple,
  type LookAtBranch,
  type LookAtDraft,
  type PointSourceDraft,
} from '../../../features/authoring/ui/pointSourceFields.ts'
import type { RefKind } from '../../../features/authoring/pointSource.ts'
import PointSourceForm from './PointSourceForm.vue'

const props = defineProps<{
  clipKey: string
  objects: JsonObject
  trackType: string
  catalog: CatalogIndex
  time: number
  flags?: Partial<OrientationRuntimeFlags>
  /** 该组在效果面板的叶子数。 */
  effectCount?: number
}>()

const emit = defineEmits<{
  apply: [items: ApplyItem[]]
}>()

const bar = computed(() => projectOrientationBar(props.objects, props.flags ?? {}))

const LOOK_AT_BRANCHES: LookAtBranch[] = ['none', 'player', 'coordinate', 'entity', 'block']
const BASE_KINDS = ['world', 'entity', 'line'] as const

const lookAt = ref<LookAtDraft>(draftLookAt(props.objects))

const selectorDraft = computed<PointSourceDraft>(() => draftPointSource(
  staticField(props.objects, 'yaw_base_selector', '@p'),
  {},
))

const COORD_KEYS = ['x', 'y', 'z'] as const

function emitApply(commands: DocCommand[], successText: string): void {
  if (commands.length === 0) {
    return
  }
  emit('apply', commands.map((command) => ({ command, successText })))
}

function write(path: string, value: JsonValue): DocCommand {
  return planSimpleWrite(props.clipKey, props.objects, path, props.time, value)
}

function coordCommands(prefix: string, coords: CoordTriple): DocCommand[] {
  return coords.map((value, index) => write(`${prefix}_${COORD_KEYS[index]}`, value))
}

// ── look_at 载荷 ────────────────────────────────────────────────────────────

const lookAtIssues = computed(() => validateLookAtDraft(lookAt.value))

/** look_at 载荷按分支收窄允许形态；none/player 无载荷表单。 */
const LOOK_KINDS: Record<LookAtBranch, RefKind[]> = {
  none: [],
  player: [],
  coordinate: ['coordinate', 'structure'],
  entity: ['selector'],
  block: ['block'],
}

const lookTargetDraft = computed<PointSourceDraft>(() => {
  const draft = lookAt.value
  if (draft.branch === 'entity') {
    return { kind: 'selector', text: draft.selector, radius: 16, coords: [null, null, null] }
  }
  if (draft.branch === 'coordinate') {
    return draft.structure !== ''
      ? { kind: 'structure', text: draft.structure, radius: 16, coords: draft.coords }
      : { kind: 'coordinate', text: '', radius: 16, coords: draft.coords }
  }
  if (draft.branch === 'block') {
    return { kind: 'block', text: draft.block, radius: 16, coords: [null, null, null] }
  }
  return { kind: 'empty', text: '', radius: 16, coords: [null, null, null] }
})

function patchLookAt(partial: Partial<LookAtDraft>): void {
  lookAt.value = { ...lookAt.value, ...partial }
}

function setBranch(branch: LookAtBranch): void {
  patchLookAt({ branch })
  commitLookAt()
}

function setPart(index: 0 | 1 | 2, raw: string): void {
  const part: CoordTriple = [...lookAt.value.part]
  part[index] = raw.trim() === '' ? null : Number(raw)
  patchLookAt({ part })
}

function onLookDraft(draft: PointSourceDraft): void {
  const current = lookAt.value
  if (current.branch === 'entity') {
    patchLookAt({ selector: draft.text })
  } else if (current.branch === 'coordinate') {
    if (draft.kind === 'structure') {
      patchLookAt({ structure: draft.text, coords: current.coords })
    } else {
      patchLookAt({ coords: draft.coords, structure: '' })
    }
  } else if (current.branch === 'block') {
    patchLookAt({ block: draft.text })
  }
  commitLookAt()
}

function commitLookAt(): void {
  const draft = lookAt.value
  if (lookAtIssues.value.length > 0) {
    return
  }
  const commands: DocCommand[] = [write('look_at', draft.branch)]
  if (draft.branch === 'entity') {
    commands.push(write('look_at_selector', draft.selector))
    draft.part.forEach((value, index) => {
      commands.push(write(`look_at_part.${COORD_KEYS[index]}`, value ?? 50))
    })
  } else if (draft.branch === 'coordinate') {
    commands.push(...coordCommands('look_at_target', draft.coords))
    commands.push(write('look_at_target_structure', draft.structure))
  } else if (draft.branch === 'block') {
    commands.push(write('look_at_target_block', draft.block))
  }
  emitApply(commands, '已更新注视目标')
}

// ── 基准 / 锁 / 端点 ─────────────────────────────────────────────────────────

function setBase(axis: 'yaw' | 'pitch', value: string): void {
  emitApply([write(`${axis}_base`, value)], `已切换 ${axis}_base`)
}

function onSelectorDraft(draft: PointSourceDraft): void {
  if (draft.text.trim().length === 0) {
    return
  }
  emitApply([write('yaw_base_selector', draft.text)], '已更新基准选择器')
}

function onFromDraft(draft: PointSourceDraft): void {
  const ref = draft.kind === 'coordinate' ? 'coordinate' : draft.text
  const commands: DocCommand[] = [write('yaw_base_from', ref)]
  if (draft.kind === 'coordinate') {
    commands.push(...coordCommands('yaw_base_from', draft.coords))
  }
  emitApply(commands, '已更新线基准起点')
}

function onToDraft(draft: PointSourceDraft): void {
  const ref = draft.kind === 'coordinate' ? 'coordinate' : draft.text
  const commands: DocCommand[] = [write('yaw_base_to', ref)]
  if (draft.kind === 'coordinate') {
    commands.push(...coordCommands('yaw_base_to', draft.coords))
  }
  emitApply(commands, '已更新线基准终点')
}

function setLock(axis: 'yaw' | 'pitch', raw: string): void {
  const value: JsonValue = raw.trim() === '' ? null : Number(raw)
  emitApply([write(`${axis}_lock`, value)], `已切换 ${axis}_lock`)
}

function toggleFreeze(path: string, checked: boolean): void {
  emitApply([write(path, checked)], `已切换 ${path}`)
}

function disabled(path: string): boolean {
  return bar.value.state.disabled[path] !== undefined
}

function lockText(axis: 'yaw' | 'pitch'): string {
  return lockNote(axis, axis === 'yaw' ? bar.value.values.yaw_lock : bar.value.values.pitch_lock)
}

function baseText(axis: 'yaw' | 'pitch'): string {
  const base = axis === 'yaw' ? bar.value.values.yaw_base : bar.value.values.pitch_base
  return baseNote(axis, base, disabled(`${axis}_base`))
}

const yawLockText = computed(() => {
  const value = bar.value.values.yaw_lock
  return value === null ? '' : String(value)
})
const pitchLockText = computed(() => {
  const value = bar.value.values.pitch_lock
  return value === null ? '' : String(value)
})
</script>

<template>
  <div class="ori-editor">
    <div class="ori-editor__summary">{{ bar.state.summary }}</div>

    <div class="ori-editor__row">
      <span class="ori-editor__label">look_at</span>
      <select
        :value="lookAt.branch"
        @change="setBranch(($event.target as HTMLSelectElement).value as LookAtBranch)"
      >
        <option v-for="branch in LOOK_AT_BRANCHES" :key="branch" :value="branch">{{ branch }}</option>
      </select>
      <span v-if="lookAt.branch === 'player'" class="ori-editor__note">注视玩家实体</span>
    </div>

    <div v-if="lookAt.branch !== 'none' && lookAt.branch !== 'player'" class="ori-editor__row">
      <span class="ori-editor__label">目标</span>
      <PointSourceForm
        field="look_at"
        :draft="lookTargetDraft"
        :kinds="LOOK_KINDS[lookAt.branch]"
        @update:draft="onLookDraft"
      />
    </div>

    <div v-if="lookAt.branch === 'entity'" class="ori-editor__row">
      <span class="ori-editor__label">part</span>
      <label class="ori-editor__coord">
        <span>X</span>
        <input type="number" min="0" max="100" :value="lookAt.part[0] ?? ''" @input="setPart(0, ($event.target as HTMLInputElement).value)" @change="commitLookAt" />
      </label>
      <label class="ori-editor__coord">
        <span>Y</span>
        <input type="number" min="0" max="100" :value="lookAt.part[1] ?? ''" @input="setPart(1, ($event.target as HTMLInputElement).value)" @change="commitLookAt" />
      </label>
      <label class="ori-editor__coord">
        <span>Z</span>
        <input type="number" min="0" max="100" :value="lookAt.part[2] ?? ''" @input="setPart(2, ($event.target as HTMLInputElement).value)" @change="commitLookAt" />
      </label>
    </div>

    <p v-if="lookAtIssues.length > 0" class="ori-editor__warning" role="alert">
      {{ lookAtIssues.map((issue) => issue.message).join('；') }}
    </p>

    <div class="ori-editor__row">
      <label class="ori-editor__field">
        <span class="ori-editor__label">yaw 基准</span>
        <select :value="bar.values.yaw_base" :disabled="disabled('yaw_base')" @change="setBase('yaw', ($event.target as HTMLSelectElement).value)">
          <option v-for="base in BASE_KINDS" :key="base" :value="base">{{ base }}</option>
        </select>
      </label>
      <label class="ori-editor__field">
        <span class="ori-editor__label">pitch 基准</span>
        <select :value="bar.values.pitch_base" :disabled="disabled('pitch_base')" @change="setBase('pitch', ($event.target as HTMLSelectElement).value)">
          <option v-for="base in BASE_KINDS" :key="base" :value="base">{{ base }}</option>
        </select>
      </label>
      <span v-if="(effectCount ?? 0) > 0" class="ori-editor__effects">{{ effectCount }} 项在效果面板</span>
    </div>

    <div class="ori-editor__note">{{ baseText('yaw') }} ｜ {{ baseText('pitch') }}</div>

    <div v-if="bar.selectorVisible" class="ori-editor__row">
      <span class="ori-editor__label">基准选择器</span>
      <PointSourceForm field="yaw_base_selector" :draft="selectorDraft" :disabled="disabled('yaw_base_selector')" @update:draft="onSelectorDraft" />
    </div>

    <div v-if="bar.values.yaw_base === 'line'" class="ori-editor__row">
      <span class="ori-editor__label">线起点</span>
      <PointSourceForm field="yaw_base_from" :draft="bar.lineFrom" @update:draft="onFromDraft" />
      <label class="ori-editor__coord">
        <input type="checkbox" :checked="staticField(objects, 'yaw_base_from_freeze', false) === true" @change="toggleFreeze('yaw_base_from_freeze', ($event.target as HTMLInputElement).checked)" />
        <span>冻结</span>
      </label>
    </div>

    <div v-if="bar.values.pitch_base === 'line'" class="ori-editor__row">
      <span class="ori-editor__label">线终点</span>
      <PointSourceForm field="yaw_base_to" :draft="bar.lineTo" @update:draft="onToDraft" />
      <label class="ori-editor__coord">
        <input type="checkbox" :checked="staticField(objects, 'yaw_base_to_freeze', false) === true" @change="toggleFreeze('yaw_base_to_freeze', ($event.target as HTMLInputElement).checked)" />
        <span>冻结</span>
      </label>
    </div>

    <div class="ori-editor__row">
      <label class="ori-editor__field">
        <span class="ori-editor__label">yaw 锁</span>
        <input type="number" :value="yawLockText" :disabled="disabled('yaw_lock')" @input="setLock('yaw', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="ori-editor__field">
        <span class="ori-editor__label">pitch 锁</span>
        <input type="number" :value="pitchLockText" :disabled="disabled('pitch_lock')" @input="setLock('pitch', ($event.target as HTMLInputElement).value)" />
      </label>
    </div>
    <div class="ori-editor__note">{{ lockText('yaw') }} ｜ {{ lockText('pitch') }}</div>

    <p v-for="warning in bar.state.warnings" :key="warning" class="ori-editor__warning" role="alert">{{ warning }}</p>
  </div>
</template>

<style scoped>
.ori-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 11px;
}

.ori-editor__summary {
  color: var(--text-secondary);
}

.ori-editor__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ori-editor__field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ori-editor__label {
  color: var(--text-muted);
  white-space: nowrap;
}

.ori-editor__text,
.ori-editor__field select,
.ori-editor__coord input {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
}

.ori-editor__coord {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
}

.ori-editor__note {
  color: var(--text-muted);
  font-size: 11px;
}

.ori-editor__effects {
  margin-left: auto;
  color: var(--accent);
  white-space: nowrap;
}

.ori-editor__warning {
  margin: 0;
  color: var(--warning);
}
</style>
