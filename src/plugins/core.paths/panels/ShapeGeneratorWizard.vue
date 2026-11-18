<script setup lang="ts">
/**
 * 圆形 / 圆弧 / 椭圆生成器向导（07-07）。
 *
 * 只渲染与转发：表单改动向上 emit `update:state`；应用时由父面板提交，
 * 本组件不调 ctx.commit、不写盘、不调运行时。payload 由父面板按计划构建后传入。
 */
import { computed } from 'vue'
import type { GeneratorApplyPayload, WizardPlanView, WizardState, CenterSpaceContext } from '../../../features/paths/generatorWizard.ts'

const props = defineProps<{
  state: WizardState
  context: CenterSpaceContext | null
  plan: WizardPlanView | null
  nodeOptions: number[]
  canApply: boolean
  impactConfirmed: boolean
  payload: GeneratorApplyPayload | null
}>()

const emit = defineEmits<{
  'update:state': [state: WizardState]
  apply: [payload: GeneratorApplyPayload]
  cancel: []
  'confirm-impact': []
}>()

const issues = computed(() => props.plan?.issues ?? [])
const warnings = computed(() => props.plan?.warnings ?? [])
const diff = computed(() => props.plan?.diff ?? null)
const axisLabels = computed<[string, string, string]>(() => props.context?.axisLabels ?? ['x', 'y', 'z'])
const worldInputAllowed = computed(() => props.context?.worldInputAllowed ?? false)

function patch(mutator: (draft: WizardState) => void): void {
  const draft: WizardState = JSON.parse(JSON.stringify(props.state)) as WizardState
  mutator(draft)
  emit('update:state', draft)
}

function setNumber(key: keyof WizardState, value: string): void {
  const parsed = Number(value)
  patch((draft) => {
    ;(draft[key] as number) = Number.isFinite(parsed) ? parsed : 0
  })
}

function setVec(key: 'center' | 'normal' | 'referenceAxis', axis: 'x' | 'y' | 'z', value: string): void {
  const parsed = Number(value)
  patch((draft) => {
    draft[key][axis] = Number.isFinite(parsed) ? parsed : 0
  })
}

const PREVIEW_W = 300
const PREVIEW_H = 120

const previewPolyline = computed<string>(() => {
  const preview = props.plan?.preview ?? []
  if (preview.length < 2) {
    return ''
  }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const sample of preview) {
    minX = Math.min(minX, sample.point[0])
    maxX = Math.max(maxX, sample.point[0])
    minZ = Math.min(minZ, sample.point[2])
    maxZ = Math.max(maxZ, sample.point[2])
  }
  const spanX = Math.max(maxX - minX, 1e-9)
  const spanZ = Math.max(maxZ - minZ, 1e-9)
  const scale = Math.min((PREVIEW_W - 24) / spanX, (PREVIEW_H - 24) / spanZ)
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  return preview
    .map((sample) => {
      const x = PREVIEW_W / 2 + (sample.point[0] - centerX) * scale
      const z = PREVIEW_H / 2 - (sample.point[2] - centerZ) * scale
      return `${x.toFixed(2)},${z.toFixed(2)}`
    })
    .join(' ')
})

const shapeOptions = [
  { value: 'circle', label: '整圆' },
  { value: 'arc', label: '圆弧' },
  { value: 'ellipse', label: '椭圆' },
] as const

const modeOptions = [
  { value: 'bezier', label: 'Bezier 分段逼近' },
  { value: 'exact', label: '精确几何（一条 arc/ellipse）' },
] as const

const timeOptions = [
  { value: 'keep-nodes', label: '保留现有节点节奏' },
  { value: 'replace', label: '替换区间内节点' },
] as const

function onApply(): void {
  if (props.payload === null || !props.canApply) {
    return
  }
  emit('apply', props.payload)
}
</script>

<template>
  <div class="shape-wizard">
    <div class="shape-wizard__row">
      <label class="shape-wizard__field">
        <span class="shape-wizard__label">区间起点（秒）</span>
        <select :value="state.from" @change="setNumber('from', ($event.target as HTMLSelectElement).value)">
          <option v-for="option in nodeOptions" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
      <label class="shape-wizard__field">
        <span class="shape-wizard__label">区间终点（秒）</span>
        <select :value="state.to" @change="setNumber('to', ($event.target as HTMLSelectElement).value)">
          <option v-for="option in nodeOptions" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
    </div>

    <div class="shape-wizard__row">
      <label class="shape-wizard__field">
        <span class="shape-wizard__label">形状</span>
        <select :value="state.shape" @change="patch((draft) => { draft.shape = ($event.target as HTMLSelectElement).value as typeof draft.shape })">
          <option v-for="option in shapeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="shape-wizard__field">
        <span class="shape-wizard__label">模式</span>
        <select :value="state.mode" @change="patch((draft) => { draft.mode = ($event.target as HTMLSelectElement).value as typeof draft.mode })">
          <option v-for="option in modeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
    </div>

    <fieldset class="shape-wizard__group">
      <legend>圆心 / 中心（{{ axisLabels.join(' / ') }}）</legend>
      <label v-if="worldInputAllowed" class="shape-wizard__check">
        <input type="checkbox" :checked="state.centerInputWorld" @change="patch((draft) => { draft.centerInputWorld = ($event.target as HTMLInputElement).checked })" />
        按世界坐标输入（写盘时减去原点）
      </label>
      <div class="shape-wizard__row">
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">{{ axisLabels[0] }}</span>
          <input type="number" :value="state.center.x" @input="setVec('center', 'x', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">{{ axisLabels[1] }}</span>
          <input type="number" :value="state.center.y" @input="setVec('center', 'y', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">{{ axisLabels[2] }}</span>
          <input type="number" :value="state.center.z" @input="setVec('center', 'z', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
    </fieldset>

    <fieldset v-if="state.shape !== 'ellipse'" class="shape-wizard__group">
      <legend>半径</legend>
      <div class="shape-wizard__row">
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">半径</span>
          <input type="number" :value="state.radius" @input="setNumber('radius', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
    </fieldset>

    <fieldset v-else class="shape-wizard__group">
      <legend>椭圆半轴与旋转</legend>
      <div class="shape-wizard__row">
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">长半轴</span>
          <input type="number" :value="state.semiMajor" @input="setNumber('semiMajor', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">短半轴</span>
          <input type="number" :value="state.semiMinor" @input="setNumber('semiMinor', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">旋转 °</span>
          <input type="number" :value="state.rotation" @input="setNumber('rotation', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
    </fieldset>

    <fieldset class="shape-wizard__group">
      <legend>角度与方向</legend>
      <div class="shape-wizard__row">
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">起始角 °</span>
          <input type="number" :value="state.startAngle" @input="setNumber('startAngle', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">结束角 °</span>
          <input type="number" :value="state.endAngle" @input="setNumber('endAngle', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="shape-wizard__check">
          <input type="checkbox" :checked="state.clockwise" @change="patch((draft) => { draft.clockwise = ($event.target as HTMLInputElement).checked })" />
          顺时针
        </label>
      </div>
    </fieldset>

    <fieldset class="shape-wizard__group">
      <legend>平面（法向 / 参考轴）</legend>
      <div class="shape-wizard__row">
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">法向 x</span>
          <input type="number" :value="state.normal.x" @input="setVec('normal', 'x', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">法向 y</span>
          <input type="number" :value="state.normal.y" @input="setVec('normal', 'y', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">法向 z</span>
          <input type="number" :value="state.normal.z" @input="setVec('normal', 'z', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
      <div class="shape-wizard__row">
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">参考轴 x</span>
          <input type="number" :value="state.referenceAxis.x" @input="setVec('referenceAxis', 'x', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">参考轴 y</span>
          <input type="number" :value="state.referenceAxis.y" @input="setVec('referenceAxis', 'y', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">参考轴 z</span>
          <input type="number" :value="state.referenceAxis.z" @input="setVec('referenceAxis', 'z', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
    </fieldset>

    <fieldset class="shape-wizard__group">
      <legend>分段与时间策略</legend>
      <div class="shape-wizard__row">
        <label class="shape-wizard__check">
          <input
            type="checkbox"
            :checked="state.segments === 'auto'"
            @change="patch((draft) => { draft.segments = ($event.target as HTMLInputElement).checked ? 'auto' : 1 })"
          />
          自动分段
        </label>
        <label class="shape-wizard__field" v-if="state.segments !== 'auto'">
          <span class="shape-wizard__label">分段数</span>
          <input type="number" :value="state.segments" @input="setNumber('segments', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
      <div class="shape-wizard__row">
        <label class="shape-wizard__field">
          <span class="shape-wizard__label">时间策略</span>
          <select :value="state.timeMode" @change="patch((draft) => { draft.timeMode = ($event.target as HTMLSelectElement).value as typeof draft.timeMode })">
            <option v-for="option in timeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
      </div>
    </fieldset>

    <svg
      v-if="previewPolyline"
      :viewBox="`0 0 ${PREVIEW_W} ${PREVIEW_H}`"
      class="shape-wizard__preview"
      role="img"
      aria-label="理想曲线预览"
    >
      <polyline :points="previewPolyline" class="shape-wizard__preview-line" />
    </svg>

    <div v-if="diff" class="shape-wizard__diff">
      <div class="shape-wizard__diff-row">
        <span>新增路径</span><strong>{{ diff.added }}</strong>
      </div>
      <div class="shape-wizard__diff-row">
        <span>替换旧路径</span><strong>{{ diff.replaced }}</strong>
      </div>
      <div class="shape-wizard__diff-row">
        <span>删除旧路径</span><strong>{{ diff.deleted }}</strong>
      </div>
      <div class="shape-wizard__diff-row" :class="{ 'is-warn': diff.impacted > 0 }">
        <span>影响其他路径</span><strong>{{ diff.impacted }}</strong>
      </div>
      <template v-if="diff.impacted > 0">
        <ul class="shape-wizard__impact">
          <li v-for="id in diff.impactedPaths" :key="id">{{ id }}</li>
        </ul>
        <label class="shape-wizard__check">
          <input type="checkbox" :checked="impactConfirmed" @change="emit('confirm-impact')" />
          已确认删除受影响路径
        </label>
      </template>
    </div>

    <ul v-if="issues.length > 0" class="shape-wizard__messages shape-wizard__messages--error">
      <li v-for="(issue, index) in issues" :key="index">{{ issue }}</li>
    </ul>
    <ul v-if="warnings.length > 0" class="shape-wizard__messages shape-wizard__messages--warn">
      <li v-for="(warning, index) in warnings" :key="index">{{ warning }}</li>
    </ul>

    <div class="shape-wizard__actions">
      <button type="button" class="shape-wizard__button" @click="emit('cancel')">取消</button>
      <button
        type="button"
        class="shape-wizard__button shape-wizard__button--primary"
        :disabled="!canApply || payload === null"
        @click="onApply"
      >
        应用
      </button>
    </div>
  </div>
</template>

<style scoped>
.shape-wizard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
}

.shape-wizard__row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.shape-wizard__group {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shape-wizard__group legend {
  font-size: 12px;
  color: var(--text-muted);
  padding: 0 4px;
}

.shape-wizard__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 90px;
}

.shape-wizard__label {
  font-size: 12px;
  color: var(--text-muted);
}

.shape-wizard__field input,
.shape-wizard__field select {
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text);
  padding: 4px 6px;
  font-family: var(--font-mono);
}

.shape-wizard__check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
}

.shape-wizard__preview {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-raised);
}

.shape-wizard__preview-line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
}

.shape-wizard__diff {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.shape-wizard__diff-row {
  display: flex;
  justify-content: space-between;
}

.shape-wizard__diff-row.is-warn strong {
  color: var(--warning);
}

.shape-wizard__impact {
  margin: 0;
  padding-left: 18px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.shape-wizard__messages {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
}

.shape-wizard__messages--error {
  color: var(--warning);
}

.shape-wizard__messages--warn {
  color: var(--text-muted);
}

.shape-wizard__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.shape-wizard__button {
  background: var(--bg-hover);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text);
  padding: 6px 14px;
  cursor: pointer;
}

.shape-wizard__button--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-raised);
}

.shape-wizard__button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
