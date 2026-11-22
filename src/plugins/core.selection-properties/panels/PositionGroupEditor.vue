<script setup lang="ts">
/**
 * 位置卡片（正式 Editor）：只决定布局、标签与可用性，值编辑全部经统一 `row` 槽。
 *
 * 分支按播放头取样（`position_mode` / `position_space` / `facing_*` 都是 STEP 字段），
 * 与主模组 `PositionEvaluator` 的每帧分派一致：
 * - 绝对位置：X / Y / Z 世界坐标；基准与方向源不参与（值保留，不清除）；
 * - 相对 · 世界轴：dX / dY / dZ 世界轴偏移；起点默认玩家激活位置，已有自定义起点则沿用；
 * - 相对 · 基准轴：`建立基准轴` 收原点、方向源与点源参数；三轴为前后 / 上下 / 左右。
 *
 * 基准轴是水平系（上轴恒为世界 +Y）；方向源只决定偏移方向，不决定相机看向哪里。
 * 三轴对齐事务、路径保护和写帧都由外壳处理，本卡片不提交任何值。
 */
import { computed } from 'vue'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { InspectorValueOptions } from '../../../features/effects/panels/inspectorValueOptions.ts'
import {
  hasEntityFacing,
  isPresent,
  originKindOf,
  pointReference,
  relabel,
  rowsByPath,
  sampledString,
  withUnavailable,
} from './cameraInspector.ts'

const props = defineProps<{
  /** 位置 section 的完整 schema 行（父不装饰；本卡片只换标签 / 标原因）。 */
  rows: readonly PropertyRow[]
  objects: JsonObject
  /** 片段局部秒。 */
  playhead: number
  timing: ClipTiming
}>()

defineSlots<{
  row: (slotProps: { row: PropertyRow; options: InspectorValueOptions; axis: boolean }) => unknown
}>()

// ── 行索引与分支取样 ────────────────────────────────────────────────────────

const byPath = computed(() => rowsByPath(props.rows))
function pick(path: string) {
  return computed(() => byPath.value.get(path))
}

const modeRow = pick('position_mode')
const spaceRow = pick('position_space')
const originRow = pick('position_origin')
const originXRow = pick('position_origin_x')
const originYRow = pick('position_origin_y')
const originZRow = pick('position_origin_z')
const originFreezeRow = pick('position_origin_freeze')
const facingSourceRow = pick('facing_source')
const facingTargetRow = pick('facing_target')
const targetXRow = pick('facing_target_x')
const targetYRow = pick('facing_target_y')
const targetZRow = pick('facing_target_z')
const targetOffsetXRow = pick('facing_target_offset.x')
const targetOffsetYRow = pick('facing_target_offset.y')
const targetOffsetZRow = pick('facing_target_offset.z')
const targetOffsetSpaceRow = pick('facing_target_offset.space')
const targetFreezeRow = pick('facing_target_freeze')
const facingEntityRow = pick('facing_entity')
const axisXRow = pick('position.x')
const axisYRow = pick('position.y')
const axisZRow = pick('position.z')

const mode = computed(() => sampledString(modeRow.value, props.playhead, props.timing, 'relative'))
const relative = computed(() => mode.value !== 'absolute')
const space = computed(() => sampledString(spaceRow.value, props.playhead, props.timing, 'world'))
const base = computed(() => relative.value && space.value === 'base')
const origin = computed(() => sampledString(originRow.value, props.playhead, props.timing, ''))
const facingSource = computed(() => sampledString(facingSourceRow.value, props.playhead, props.timing, 'auto'))
const facingTarget = computed(() => sampledString(facingTargetRow.value, props.playhead, props.timing, ''))
const facingEntity = computed(() => sampledString(facingEntityRow.value, props.playhead, props.timing, ''))
const targetOffsetSpace = computed(() => sampledString(
  targetOffsetSpaceRow.value,
  props.playhead,
  props.timing,
  'world',
))

/** 点源引用形态决定是否展开坐标三轴（坐标不在 ref 字符串里）。 */
const originIsCoordinate = computed(() => origin.value === 'coordinate')
const targetIsCoordinate = computed(() => facingTarget.value === 'coordinate')
const targetOffsetBaseIgnored = computed(() => targetOffsetSpace.value === 'base')

// ── `facing_source=auto` 的真实回落（与主模组 `autoSource` 同序） ─────────────

const autoConflict = computed(() => facingTarget.value !== '' && facingEntity.value !== '')

const autoResolved = computed<'line' | 'entity' | 'world' | 'error'>(() => {
  if (facingTarget.value !== '') {
    return 'line'
  }
  if (facingEntity.value !== '') {
    return 'entity'
  }
  const kind = originKindOf(origin.value)
  return kind === 'selector' ? 'entity' : 'world'
})

const autoError = computed<string | null>(() => {
  if (autoConflict.value) {
    return '方向目标和方向实体只能指定一个：清空其中一个再写入。'
  }
  if (facingTarget.value === '' && facingEntity.value === '') {
    const kind = originKindOf(origin.value)
    if (kind === 'player') {
      // 主模组：origin WORLD 在 auto 下选 ENTITY，但 entityFrame 只接受 SELECTOR → 抛异常。
      return '玩家激活位置没有实体朝向。请指定方向实体，或把基准轴朝向改为固定世界方向。'
    }
  }
  return null
})

const autoNote = computed<string>(() => {
  if (autoConflict.value) {
    return ''
  }
  if (facingTarget.value !== '') {
    return '前向沿原点到目标的水平连线。'
  }
  if (facingEntity.value !== '') {
    return '前向跟随实体身体的水平朝向。'
  }
  return autoResolved.value === 'entity'
    ? '前向跟随原点实体身体的水平朝向（空原点在基准轴分支是隐式 @p）。'
    : '前向为世界 +Z，右为 −X，上为 +Y。'
})

/** 显式 `entity` 分支：空载荷要能回落到实体原点，否则运行时抛异常。 */
const entitySourceError = computed<string | null>(() => (
  facingSource.value === 'entity' && facingEntity.value === '' && !hasEntityFacing(origin.value)
    ? '当前原点无法提供实体朝向，请指定方向实体或改用固定世界方向。'
    : null
))

const lineSourceError = computed<string | null>(() => (
  facingSource.value === 'line' && facingTarget.value === '' ? '请选择一个方向目标。' : null
))

/**
 * `facing_target` 只在显式 line 或 auto 回落到 line 时才参与；
 * 其余分支即使字段有值也不读取（值保留）。
 */
const targetActive = computed(() => (
  facingSource.value === 'line'
  || (facingSource.value === 'auto' && facingTarget.value !== '')
))

const worldNote = '前向为世界 +Z，右为 −X，上为 +Y。'

// ── 轴标签与选项 ────────────────────────────────────────────────────────────

const AXIS_LABELS = computed<Record<'x' | 'y' | 'z', string>>(() => {
  if (!relative.value) {
    return { x: 'X', y: 'Y', z: 'Z' }
  }
  if (base.value) {
    return { x: '前后', y: '上下', z: '左右' }
  }
  return { x: 'dX', y: 'dY', z: 'dZ' }
})

const axisTitle = computed(() => {
  if (!relative.value) {
    return '世界坐标'
  }
  return base.value ? '沿基准轴的偏移' : '沿世界轴的偏移'
})

const modeOptions: InspectorValueOptions = {
  labels: { relative: '相对位置', absolute: '绝对位置' },
  segmented: true,
}

const spaceOptions: InspectorValueOptions = {
  labels: { world: '世界轴', base: '基准轴' },
  segmented: true,
}

const facingSourceOptions: InspectorValueOptions = {
  labels: {
    auto: '自动',
    world: '固定世界方向',
    entity: '实体身体朝向',
    line: '原点指向目标',
  },
}

const offsetSpaceOptions: InspectorValueOptions = {
  labels: { world: '世界轴', base: '基准轴' },
}

const plainOptions: InspectorValueOptions = {}
const axisOptions: InspectorValueOptions = {}

const originOptions: InspectorValueOptions = {
  reference: pointReference('position_origin', '默认 · 跟随玩家脚底'),
}
const targetOptions: InspectorValueOptions = {
  reference: pointReference('facing_target', '未指定'),
}
const entityOptions: InspectorValueOptions = {
  reference: pointReference('facing_entity', '沿用原点实体'),
}

/** 世界轴起点提示：自定义起点沿用，缺省取激活位置（不是实时玩家位置）。 */
const worldOriginNote = computed(() => {
  const kind = originKindOf(origin.value)
  if (kind === 'player' || origin.value === '') {
    return '偏移从玩家激活脚本时的位置算起。'
  }
  return '脚本已指定起点，偏移沿用该起点。'
})
</script>

<template>
  <section class="pos-card" aria-label="位置">
    <header class="pos-card__head">
      <span class="pos-card__title">位置</span>
      <span class="pos-card__mode">{{ relative ? (base ? '相对 · 基准轴' : '相对 · 世界轴') : '绝对' }}</span>
    </header>

    <div class="pos-card__body">
      <slot
        v-if="modeRow"
        name="row"
        :row="relabel(modeRow, '位置模式')"
        :options="modeOptions"
        :axis="false"
      />

      <slot
        v-if="relative && spaceRow"
        name="row"
        :row="relabel(spaceRow, '坐标轴')"
        :options="spaceOptions"
        :axis="false"
      />

      <!-- 仅基准轴：建立基准轴（原点 / 方向源 / 点源参数） -->
      <fieldset v-if="base" class="pos-basis base-frame">
        <legend>建立基准轴</legend>

        <slot
          v-if="originRow"
          name="row"
          :row="relabel(originRow, '基准原点')"
          :options="originOptions"
          :axis="false"
        />

        <div v-if="originIsCoordinate" class="pos-axis">
          <div v-if="originXRow" class="pos-axis__cell">
            <slot name="row" :row="relabel(originXRow, '原点 X')" :options="plainOptions" :axis="true" />
          </div>
          <div v-if="originYRow" class="pos-axis__cell">
            <slot name="row" :row="relabel(originYRow, '原点 Y')" :options="plainOptions" :axis="true" />
          </div>
          <div v-if="originZRow" class="pos-axis__cell">
            <slot name="row" :row="relabel(originZRow, '原点 Z')" :options="plainOptions" :axis="true" />
          </div>
        </div>

        <details v-if="originFreezeRow" class="pos-fold">
          <summary>原点选项</summary>
          <slot
            name="row"
            :row="relabel(originFreezeRow, '固定首次相机位置')"
            :options="plainOptions"
            :axis="false"
          />
          <p class="pos-note">冻结首次解析后的世界位置；原点是动态坐标时冻结不会生效。</p>
        </details>

        <slot
          v-if="facingSourceRow"
          name="row"
          :row="relabel(facingSourceRow, '基准轴朝向')"
          :options="facingSourceOptions"
          :axis="false"
        />

        <p v-if="facingSource === 'world'" class="pos-note">{{ worldNote }}</p>

        <template v-else-if="facingSource === 'line'">
          <!-- line：原点 → 目标水平连线 -->
          <slot
            v-if="facingTargetRow"
            name="row"
            :row="relabel(facingTargetRow, '方向目标')"
            :options="targetOptions"
            :axis="false"
          />
          <div v-if="targetIsCoordinate" class="pos-axis">
            <div v-if="targetXRow" class="pos-axis__cell">
              <slot name="row" :row="relabel(targetXRow, '目标 X')" :options="plainOptions" :axis="true" />
            </div>
            <div v-if="targetYRow" class="pos-axis__cell">
              <slot name="row" :row="relabel(targetYRow, '目标 Y')" :options="plainOptions" :axis="true" />
            </div>
            <div v-if="targetZRow" class="pos-axis__cell">
              <slot name="row" :row="relabel(targetZRow, '目标 Z')" :options="plainOptions" :axis="true" />
            </div>
          </div>
          <p v-if="lineSourceError !== null" class="pos-warning" role="alert">{{ lineSourceError }}</p>
          <p v-else class="pos-note">前向沿原点到目标的水平连线。</p>
        </template>

        <template v-else-if="facingSource === 'entity'">
          <!-- entity：显式实体，空则回落实体原点 -->
          <slot
            v-if="facingEntityRow"
            name="row"
            :row="relabel(facingEntityRow, '方向实体')"
            :options="entityOptions"
            :axis="false"
          />
          <p v-if="entitySourceError !== null" class="pos-warning" role="alert">{{ entitySourceError }}</p>
          <p v-else class="pos-note">
            前向跟随实体身体的水平朝向；不读视线俯仰{{ facingEntity === '' ? '，空载荷沿用原点实体' : '' }}。
          </p>
        </template>

        <template v-else>
          <!-- auto：target → entity → 原点形态 -->
          <template v-if="autoConflict">
            <slot
              v-if="facingTargetRow"
              name="row"
              :row="relabel(facingTargetRow, '方向目标')"
              :options="targetOptions"
              :axis="false"
            />
            <slot
              v-if="facingEntityRow"
              name="row"
              :row="relabel(facingEntityRow, '方向实体')"
              :options="entityOptions"
              :axis="false"
            />
            <div v-if="targetIsCoordinate" class="pos-axis">
              <div v-if="targetXRow" class="pos-axis__cell">
                <slot name="row" :row="relabel(targetXRow, '目标 X')" :options="plainOptions" :axis="true" />
              </div>
              <div v-if="targetYRow" class="pos-axis__cell">
                <slot name="row" :row="relabel(targetYRow, '目标 Y')" :options="plainOptions" :axis="true" />
              </div>
              <div v-if="targetZRow" class="pos-axis__cell">
                <slot name="row" :row="relabel(targetZRow, '目标 Z')" :options="plainOptions" :axis="true" />
              </div>
            </div>
          </template>
          <p v-if="autoError !== null" class="pos-warning" role="alert">{{ autoError }}</p>
          <p v-else class="pos-note">{{ autoNote }}</p>

          <details v-if="!autoConflict" class="pos-fold" :open="autoResolved === 'line'">
            <summary>自动方向设置</summary>
            <slot
              v-if="facingTargetRow"
              name="row"
              :row="relabel(facingTargetRow, '方向目标')"
              :options="targetOptions"
              :axis="false"
            />
            <div v-if="targetIsCoordinate" class="pos-axis">
              <div v-if="targetXRow" class="pos-axis__cell">
                <slot name="row" :row="relabel(targetXRow, '目标 X')" :options="plainOptions" :axis="true" />
              </div>
              <div v-if="targetYRow" class="pos-axis__cell">
                <slot name="row" :row="relabel(targetYRow, '目标 Y')" :options="plainOptions" :axis="true" />
              </div>
              <div v-if="targetZRow" class="pos-axis__cell">
                <slot name="row" :row="relabel(targetZRow, '目标 Z')" :options="plainOptions" :axis="true" />
              </div>
            </div>
            <slot
              v-if="facingEntityRow"
              name="row"
              :row="relabel(facingEntityRow, '方向实体')"
              :options="entityOptions"
              :axis="false"
            />
            <p class="pos-note">两者只能指定一个；都为空时按原点形态回落。</p>
          </details>
        </template>

        <!-- 目标偏移 / 空间 / 冻结：位置分支的既有低频项 -->
        <details v-if="targetActive" class="pos-fold">
          <summary>目标偏移与冻结</summary>
          <div class="pos-axis">
            <div v-if="targetOffsetXRow" class="pos-axis__cell">
              <slot
                name="row"
                :row="targetOffsetBaseIgnored
                  ? withUnavailable(relabel(targetOffsetXRow, '偏移 X'), '基准空间的偏移在运行时被忽略，只生效世界轴')
                  : relabel(targetOffsetXRow, '偏移 X')"
                :options="plainOptions"
                :axis="true"
              />
            </div>
            <div v-if="targetOffsetYRow" class="pos-axis__cell">
              <slot
                name="row"
                :row="targetOffsetBaseIgnored
                  ? withUnavailable(relabel(targetOffsetYRow, '偏移 Y'), '基准空间的偏移在运行时被忽略，只生效世界轴')
                  : relabel(targetOffsetYRow, '偏移 Y')"
                :options="plainOptions"
                :axis="true"
              />
            </div>
            <div v-if="targetOffsetZRow" class="pos-axis__cell">
              <slot
                name="row"
                :row="targetOffsetBaseIgnored
                  ? withUnavailable(relabel(targetOffsetZRow, '偏移 Z'), '基准空间的偏移在运行时被忽略，只生效世界轴')
                  : relabel(targetOffsetZRow, '偏移 Z')"
                :options="plainOptions"
                :axis="true"
              />
            </div>
          </div>
          <slot
            v-if="targetOffsetSpaceRow"
            name="row"
            :row="relabel(targetOffsetSpaceRow, '偏移空间')"
            :options="offsetSpaceOptions"
            :axis="false"
          />
          <slot
            v-if="targetFreezeRow"
            name="row"
            :row="relabel(targetFreezeRow, '目标冻结')"
            :options="plainOptions"
            :axis="false"
          />
          <p v-if="targetOffsetBaseIgnored" class="pos-note">
            连线目标按世界轴解析，基准空间的偏移不生效（运行时事实）。
          </p>
        </details>

        <p class="pos-note">
          基准轴是水平系，上轴恒为世界 +Y；方向源只决定偏移方向，不决定相机看向哪里。
        </p>
      </fieldset>

      <!-- 三轴：各自 schema 行与帧状态，逐行全宽排列。 -->
      <div class="pos-axis-label">{{ axisTitle }}</div>
      <div class="pos-axis">
        <div v-if="axisXRow" class="pos-axis__cell">
          <slot name="row" :row="relabel(axisXRow, AXIS_LABELS.x)" :options="axisOptions" :axis="true" />
        </div>
        <div v-if="axisYRow" class="pos-axis__cell">
          <slot name="row" :row="relabel(axisYRow, AXIS_LABELS.y)" :options="axisOptions" :axis="true" />
        </div>
        <div v-if="axisZRow" class="pos-axis__cell">
          <slot name="row" :row="relabel(axisZRow, AXIS_LABELS.z)" :options="axisOptions" :axis="true" />
        </div>
      </div>

      <p v-if="relative && !base" class="pos-note">
        世界轴偏移不读取方向源。{{ worldOriginNote }}
      </p>
      <p v-else-if="!relative" class="pos-note">
        绝对位置直接写世界坐标；基准与方向源不参与，已有基准字段保留不清值。
      </p>

      <p v-if="isPresent(originRow) && !base" class="pos-note">
        原点字段已保留（{{ relative ? '世界轴分支只提示起点沿用' : '绝对位置不读取基准' }}），切回基准轴可继续编辑。
      </p>
    </div>
  </section>
</template>

<style scoped>
.pos-card {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.pos-card__head {
  display: flex;
  align-items: baseline;
  gap: 3px;
  padding: 2px 0;
}

.pos-card__title {
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
}

.pos-card__mode {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.pos-card__body {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.pos-basis {
  margin: 0;
  padding: 0;
  border: 0;
  min-inline-size: 0;
}

.pos-basis > legend {
  padding: 0 8px 0 0;
  color: var(--text-secondary);
  font-weight: 650;
}

.pos-axis {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.pos-axis__cell {
  min-width: 0;
}

.pos-axis-label {
  color: var(--text-muted);
  font-size: 11px;
  padding-top: 4px;
}

.pos-fold {
  margin: 0;
  padding: 0;
  border-top: 0;
}

.pos-fold > summary {
  color: var(--text-secondary);
  font-size: 11px;
  padding: 3px 0;
  cursor: pointer;
}

.pos-note {
  margin: 0;
  padding: 3px 0 5px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.pos-warning {
  margin: 0;
  color: var(--warning);
  font-size: 11px;
  line-height: 1.45;
}
</style>
