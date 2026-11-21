<script setup lang="ts">
/**
 * 朝向卡片（正式 Editor）：只决定布局、标签与可用性，值编辑全部经统一 `row` 槽。
 *
 * 与主模组 `OrientationEvaluator` 同序：`look_at` 目标可解析 → 切线 → 手动。
 * - 注视目标与适用载荷在组上方；目标可解析时角度设置作为后备入口收进小组；
 * - 手动支的偏航 / 俯仰与切线支的偏航偏移 / 俯仰偏移分开标注，不混同一个标签；
 * - 每轴基准 / 锁、线基准端点、目标偏移冻结等低频项按适用条件放进小组，隐藏项不清值；
 * - `roll` 始终在底部（渲染期绕视线轴追加，不参与 yaw/pitch 基准）。
 *
 * 本卡片不解析世界坐标，也不声称目标一定能解析；目标失效的文案只描述运行时回落条件。
 */
import { computed } from 'vue'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { InspectorValueOptions } from '../../../features/effects/panels/inspectorValueOptions.ts'
import {
  isPresent,
  pointReference,
  relabel,
  rowsByPath,
  sampledString,
  withUnavailable,
} from './cameraInspector.ts'

const props = defineProps<{
  /** 朝向 section 的完整 schema 行（父不装饰；本卡片只换标签 / 标原因）。 */
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

const lookAtRow = pick('look_at')
const selectorRow = pick('look_at_selector')
const partXRow = pick('look_at_part.x')
const partYRow = pick('look_at_part.y')
const partZRow = pick('look_at_part.z')
const targetXRow = pick('look_at_target_x')
const targetYRow = pick('look_at_target_y')
const targetZRow = pick('look_at_target_z')
const targetStructureRow = pick('look_at_target_structure')
const targetBlockRow = pick('look_at_target_block')
const offsetXRow = pick('look_at_offset.x')
const offsetYRow = pick('look_at_offset.y')
const offsetZRow = pick('look_at_offset.z')
const offsetSpaceRow = pick('look_at_offset.space')
const targetFreezeRow = pick('look_at_freeze')
const orientRow = pick('orient')
const yawRow = pick('yaw')
const pitchRow = pick('pitch')
const yawOffsetRow = pick('yaw_offset')
const pitchOffsetRow = pick('pitch_offset')
const rollRow = pick('roll')
const yawBaseRow = pick('yaw_base')
const pitchBaseRow = pick('pitch_base')
const yawLockRow = pick('yaw_lock')
const pitchLockRow = pick('pitch_lock')
const baseSelectorRow = pick('yaw_base_selector')
const fromRow = pick('yaw_base_from')
const fromXRow = pick('yaw_base_from_x')
const fromYRow = pick('yaw_base_from_y')
const fromZRow = pick('yaw_base_from_z')
const fromOffsetXRow = pick('yaw_base_from_offset.x')
const fromOffsetYRow = pick('yaw_base_from_offset.y')
const fromOffsetZRow = pick('yaw_base_from_offset.z')
const fromOffsetSpaceRow = pick('yaw_base_from_offset.space')
const fromFreezeRow = pick('yaw_base_from_freeze')
const toRow = pick('yaw_base_to')
const toXRow = pick('yaw_base_to_x')
const toYRow = pick('yaw_base_to_y')
const toZRow = pick('yaw_base_to_z')
const toOffsetXRow = pick('yaw_base_to_offset.x')
const toOffsetYRow = pick('yaw_base_to_offset.y')
const toOffsetZRow = pick('yaw_base_to_offset.z')
const toOffsetSpaceRow = pick('yaw_base_to_offset.space')
const toFreezeRow = pick('yaw_base_to_freeze')

const lookAt = computed(() => sampledString(lookAtRow.value, props.playhead, props.timing, 'none'))
const orient = computed(() => sampledString(orientRow.value, props.playhead, props.timing, 'manual'))
const tangent = computed(() => orient.value === 'tangent')
const yawBase = computed(() => sampledString(yawBaseRow.value, props.playhead, props.timing, 'world'))
const pitchBase = computed(() => sampledString(pitchBaseRow.value, props.playhead, props.timing, 'world'))
const hasTarget = computed(() => (
  lookAt.value === 'player'
  || lookAt.value === 'coordinate'
  || lookAt.value === 'entity'
  || lookAt.value === 'block'
))
const baseNeedsSelector = computed(() => yawBase.value === 'entity' || pitchBase.value === 'entity')
const baseNeedsLine = computed(() => yawBase.value === 'line' || pitchBase.value === 'line')

/** 坐标 / 偏移空间的引用形态（坐标三轴不在 ref 字符串里）。 */
const fromIsCoordinate = computed(() => sampledString(fromRow.value, props.playhead, props.timing, '') === 'coordinate')
const toIsCoordinate = computed(() => sampledString(toRow.value, props.playhead, props.timing, '') === 'coordinate')
const fromOffsetBaseIgnored = computed(() => sampledString(fromOffsetSpaceRow.value, props.playhead, props.timing, 'world') === 'base')
const toOffsetBaseIgnored = computed(() => sampledString(toOffsetSpaceRow.value, props.playhead, props.timing, 'world') === 'base')
const targetOffsetBaseIgnored = computed(() => sampledString(offsetSpaceRow.value, props.playhead, props.timing, 'world') === 'base')

/** 手动模式下已有切线偏移值要能找回；无值时不额外铺行。 */
const hasOffsetValues = computed(() => isPresent(yawOffsetRow.value) || isPresent(pitchOffsetRow.value))

// ── 选项 ────────────────────────────────────────────────────────────────────

const plainOptions: InspectorValueOptions = {}
const axisOptions: InspectorValueOptions = {}
const partOptions: InspectorValueOptions = { range: [0, 100, 1] }

const lookAtOptions: InspectorValueOptions = {
  labels: {
    none: '关闭',
    player: '玩家激活位置',
    coordinate: '指定坐标',
    entity: '实体',
    block: '附近方块中心',
  },
}

const orientOptions: InspectorValueOptions = {
  labels: { manual: '手动', tangent: '切线' },
}

const baseOptions: InspectorValueOptions = {
  labels: { world: '世界基准', entity: '实体基准', line: '线基准' },
}

const offsetSpaceOptions: InspectorValueOptions = {
  labels: { world: '世界轴', base: '基准轴' },
}

const selectorOptions: InspectorValueOptions = {
  reference: pointReference('yaw_base_selector', '默认 · @p'),
}
const fromOptions: InspectorValueOptions = {
  reference: pointReference('yaw_base_from', '未指定'),
}
const toOptions: InspectorValueOptions = {
  reference: pointReference('yaw_base_to', '未指定'),
}

const blockOptions: InspectorValueOptions = {
  placeholder: 'minecraft:stone',
}

const structureOptions: InspectorValueOptions = {
  placeholder: 'minecraft:village_plains',
}

/** 基准 / 锁说明（锁替换基准，再叠加角度；不是绝对值钳制）。 */
const LOCK_NOTE = '锁非空时替换该轴基准，随后再叠加偏航 / 俯仰角。'
</script>

<template>
  <section class="ori-card" aria-label="朝向">
    <header class="ori-card__head">
      <span class="ori-card__title">朝向</span>
      <span class="ori-card__meta">注视目标 → 切线 → 手动</span>
    </header>

    <div class="ori-card__body">
      <slot
        v-if="lookAtRow"
        name="row"
        :row="relabel(lookAtRow, '注视目标')"
        :options="lookAtOptions"
        :axis="false"
      />

      <!-- 随注视目标展开的适用载荷 -->
      <template v-if="lookAt === 'coordinate'">
        <div class="ori-axis">
          <div v-if="targetXRow" class="ori-axis__cell">
            <slot name="row" :row="relabel(targetXRow, '目标 X')" :options="plainOptions" :axis="true" />
          </div>
          <div v-if="targetYRow" class="ori-axis__cell">
            <slot name="row" :row="relabel(targetYRow, '目标 Y')" :options="plainOptions" :axis="true" />
          </div>
          <div v-if="targetZRow" class="ori-axis__cell">
            <slot name="row" :row="relabel(targetZRow, '目标 Z')" :options="plainOptions" :axis="true" />
          </div>
        </div>
        <p class="ori-note">目标结构非空时优先于这三个坐标。</p>
      </template>

      <template v-else-if="lookAt === 'entity'">
        <slot
          v-if="selectorRow"
          name="row"
          :row="relabel(selectorRow, '注视实体')"
          :options="plainOptions"
          :axis="false"
        />
        <div class="ori-axis">
          <div v-if="partXRow" class="ori-axis__cell">
            <slot name="row" :row="relabel(partXRow, '取点 X')" :options="partOptions" :axis="true" />
          </div>
          <div v-if="partYRow" class="ori-axis__cell">
            <slot name="row" :row="relabel(partYRow, '取点 Y')" :options="partOptions" :axis="true" />
          </div>
          <div v-if="partZRow" class="ori-axis__cell">
            <slot name="row" :row="relabel(partZRow, '取点 Z')" :options="partOptions" :axis="true" />
          </div>
        </div>
        <p class="ori-note">取点是实体包围盒内的百分比；空选择器按目录缺省 @p。</p>
      </template>

      <template v-else-if="lookAt === 'block'">
        <slot
          v-if="targetBlockRow"
          name="row"
          :row="relabel(targetBlockRow, '方块 ID 和可选半径')"
          :options="blockOptions"
          :axis="false"
        />
        <p class="ori-note">取玩家附近最近方块中心；默认半径 16，实际取 max(16, 半径)。</p>
      </template>

      <template v-else-if="lookAt === 'player'">
        <p class="ori-note">注视玩家激活脚本时的位置（整场固定），不读取注视实体选择器。</p>
      </template>

      <!-- 目标偏移 / 结构 / 冻结：适用但低频 -->
      <details v-if="hasTarget" class="ori-fold">
        <summary>目标附加（结构 / 偏移 / 冻结）</summary>
        <slot
          v-if="lookAt === 'coordinate' && targetStructureRow"
          name="row"
          :row="relabel(targetStructureRow, '目标结构')"
          :options="structureOptions"
          :axis="false"
        />
        <div class="ori-axis">
          <div v-if="offsetXRow" class="ori-axis__cell">
            <slot name="row" :row="relabel(offsetXRow, '目标偏移 X')" :options="plainOptions" :axis="true" />
          </div>
          <div v-if="offsetYRow" class="ori-axis__cell">
            <slot name="row" :row="relabel(offsetYRow, '目标偏移 Y')" :options="plainOptions" :axis="true" />
          </div>
          <div v-if="offsetZRow" class="ori-axis__cell">
            <slot name="row" :row="relabel(offsetZRow, '目标偏移 Z')" :options="plainOptions" :axis="true" />
          </div>
        </div>
        <slot
          v-if="offsetSpaceRow"
          name="row"
          :row="relabel(offsetSpaceRow, '偏移空间')"
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
        <p v-if="targetOffsetBaseIgnored" class="ori-note">
          基准空间偏移只在位置空间为基准轴时生效；否则只读世界轴分量。
        </p>
      </details>

      <!-- 角度：无目标时为主入口；有目标时作为目标不可解析的后备入口 -->
      <details class="ori-angle" :open="!hasTarget">
        <summary v-if="hasTarget">目标不可用时的朝向</summary>

        <slot
          v-if="orientRow"
          name="row"
          :row="relabel(orientRow, '朝向模式')"
          :options="orientOptions"
          :axis="false"
        />

        <template v-if="tangent">
          <div class="ori-axis">
            <div v-if="yawOffsetRow" class="ori-axis__cell">
              <slot name="row" :row="relabel(yawOffsetRow, '偏航偏移')" :options="plainOptions" :axis="true" />
            </div>
            <div v-if="pitchOffsetRow" class="ori-axis__cell">
              <slot name="row" :row="relabel(pitchOffsetRow, '俯仰偏移')" :options="plainOptions" :axis="true" />
            </div>
          </div>
          <details class="ori-fold">
            <summary>切线无效时的手动角度</summary>
            <div class="ori-axis">
              <div v-if="yawRow" class="ori-axis__cell">
                <slot name="row" :row="relabel(yawRow, '偏航')" :options="plainOptions" :axis="true" />
              </div>
              <div v-if="pitchRow" class="ori-axis__cell">
                <slot name="row" :row="relabel(pitchRow, '俯仰')" :options="plainOptions" :axis="true" />
              </div>
            </div>
            <p class="ori-note">切线方向缺失或长度过小时回退手动值；手动值不受切线偏移影响。</p>
          </details>
        </template>

        <template v-else>
          <div class="ori-axis">
            <div v-if="yawRow" class="ori-axis__cell">
              <slot name="row" :row="relabel(yawRow, '偏航')" :options="plainOptions" :axis="true" />
            </div>
            <div v-if="pitchRow" class="ori-axis__cell">
              <slot name="row" :row="relabel(pitchRow, '俯仰')" :options="plainOptions" :axis="true" />
            </div>
          </div>
          <details v-if="hasOffsetValues" class="ori-fold">
            <summary>切线偏移（已有值）</summary>
            <div class="ori-axis">
              <div v-if="yawOffsetRow" class="ori-axis__cell">
                <slot name="row" :row="relabel(yawOffsetRow, '偏航偏移')" :options="plainOptions" :axis="true" />
              </div>
              <div v-if="pitchOffsetRow" class="ori-axis__cell">
                <slot name="row" :row="relabel(pitchOffsetRow, '俯仰偏移')" :options="plainOptions" :axis="true" />
              </div>
            </div>
            <p class="ori-note">偏移只在朝向模式为切线且切线有效时叠加；当前手动模式不读取。</p>
          </details>
        </template>

        <!-- 每轴基准 / 锁 -->
        <div class="ori-base">
          <div class="ori-axis">
            <div v-if="yawBaseRow" class="ori-axis__cell">
              <slot name="row" :row="relabel(yawBaseRow, '偏航基准')" :options="baseOptions" :axis="false" />
            </div>
            <div v-if="pitchBaseRow" class="ori-axis__cell">
              <slot name="row" :row="relabel(pitchBaseRow, '俯仰基准')" :options="baseOptions" :axis="false" />
            </div>
          </div>
          <div class="ori-axis">
            <div v-if="yawLockRow" class="ori-axis__cell">
              <slot name="row" :row="relabel(yawLockRow, '偏航锁')" :options="plainOptions" :axis="false" />
            </div>
            <div v-if="pitchLockRow" class="ori-axis__cell">
              <slot name="row" :row="relabel(pitchLockRow, '俯仰锁')" :options="plainOptions" :axis="false" />
            </div>
          </div>
          <p class="ori-note">{{ LOCK_NOTE }}</p>

          <slot
            v-if="baseNeedsSelector && baseSelectorRow"
            name="row"
            :row="relabel(baseSelectorRow, '基准选择器')"
            :options="selectorOptions"
            :axis="false"
          />
          <p v-if="baseNeedsSelector" class="ori-note">偏航基准读实体身体朝向；俯仰基准读视线俯仰。</p>

          <details v-if="baseNeedsLine" class="ori-fold">
            <summary>线基准端点</summary>

            <slot
              v-if="fromRow"
              name="row"
              :row="relabel(fromRow, '线基准起点')"
              :options="fromOptions"
              :axis="false"
            />
            <div v-if="fromIsCoordinate" class="ori-axis">
              <div v-if="fromXRow" class="ori-axis__cell">
                <slot name="row" :row="relabel(fromXRow, '起点 X')" :options="plainOptions" :axis="true" />
              </div>
              <div v-if="fromYRow" class="ori-axis__cell">
                <slot name="row" :row="relabel(fromYRow, '起点 Y')" :options="plainOptions" :axis="true" />
              </div>
              <div v-if="fromZRow" class="ori-axis__cell">
                <slot name="row" :row="relabel(fromZRow, '起点 Z')" :options="plainOptions" :axis="true" />
              </div>
            </div>

            <slot
              v-if="toRow"
              name="row"
              :row="relabel(toRow, '线基准终点')"
              :options="toOptions"
              :axis="false"
            />
            <div v-if="toIsCoordinate" class="ori-axis">
              <div v-if="toXRow" class="ori-axis__cell">
                <slot name="row" :row="relabel(toXRow, '终点 X')" :options="plainOptions" :axis="true" />
              </div>
              <div v-if="toYRow" class="ori-axis__cell">
                <slot name="row" :row="relabel(toYRow, '终点 Y')" :options="plainOptions" :axis="true" />
              </div>
              <div v-if="toZRow" class="ori-axis__cell">
                <slot name="row" :row="relabel(toZRow, '终点 Z')" :options="plainOptions" :axis="true" />
              </div>
            </div>

            <details class="ori-fold">
              <summary>端点偏移与冻结</summary>
              <div class="ori-axis">
                <div v-if="fromOffsetXRow" class="ori-axis__cell">
                  <slot
                    name="row"
                    :row="fromOffsetBaseIgnored
                      ? withUnavailable(relabel(fromOffsetXRow, '起点偏移 X'), '基准空间的偏移在运行时被忽略，只生效世界轴')
                      : relabel(fromOffsetXRow, '起点偏移 X')"
                    :options="plainOptions"
                    :axis="true"
                  />
                </div>
                <div v-if="fromOffsetYRow" class="ori-axis__cell">
                  <slot
                    name="row"
                    :row="fromOffsetBaseIgnored
                      ? withUnavailable(relabel(fromOffsetYRow, '起点偏移 Y'), '基准空间的偏移在运行时被忽略，只生效世界轴')
                      : relabel(fromOffsetYRow, '起点偏移 Y')"
                    :options="plainOptions"
                    :axis="true"
                  />
                </div>
                <div v-if="fromOffsetZRow" class="ori-axis__cell">
                  <slot
                    name="row"
                    :row="fromOffsetBaseIgnored
                      ? withUnavailable(relabel(fromOffsetZRow, '起点偏移 Z'), '基准空间的偏移在运行时被忽略，只生效世界轴')
                      : relabel(fromOffsetZRow, '起点偏移 Z')"
                    :options="plainOptions"
                    :axis="true"
                  />
                </div>
              </div>
              <slot
                v-if="fromOffsetSpaceRow"
                name="row"
                :row="relabel(fromOffsetSpaceRow, '起点偏移空间')"
                :options="offsetSpaceOptions"
                :axis="false"
              />
              <slot
                v-if="fromFreezeRow"
                name="row"
                :row="relabel(fromFreezeRow, '起点冻结')"
                :options="plainOptions"
                :axis="false"
              />

              <div class="ori-axis">
                <div v-if="toOffsetXRow" class="ori-axis__cell">
                  <slot
                    name="row"
                    :row="toOffsetBaseIgnored
                      ? withUnavailable(relabel(toOffsetXRow, '终点偏移 X'), '基准空间的偏移在运行时被忽略，只生效世界轴')
                      : relabel(toOffsetXRow, '终点偏移 X')"
                    :options="plainOptions"
                    :axis="true"
                  />
                </div>
                <div v-if="toOffsetYRow" class="ori-axis__cell">
                  <slot
                    name="row"
                    :row="toOffsetBaseIgnored
                      ? withUnavailable(relabel(toOffsetYRow, '终点偏移 Y'), '基准空间的偏移在运行时被忽略，只生效世界轴')
                      : relabel(toOffsetYRow, '终点偏移 Y')"
                    :options="plainOptions"
                    :axis="true"
                  />
                </div>
                <div v-if="toOffsetZRow" class="ori-axis__cell">
                  <slot
                    name="row"
                    :row="toOffsetBaseIgnored
                      ? withUnavailable(relabel(toOffsetZRow, '终点偏移 Z'), '基准空间的偏移在运行时被忽略，只生效世界轴')
                      : relabel(toOffsetZRow, '终点偏移 Z')"
                    :options="plainOptions"
                    :axis="true"
                  />
                </div>
              </div>
              <slot
                v-if="toOffsetSpaceRow"
                name="row"
                :row="relabel(toOffsetSpaceRow, '终点偏移空间')"
                :options="offsetSpaceOptions"
                :axis="false"
              />
              <slot
                v-if="toFreezeRow"
                name="row"
                :row="relabel(toFreezeRow, '终点冻结')"
                :options="plainOptions"
                :axis="false"
              />
              <p class="ori-note">线基准端点的基准空间偏移永远不生效；端点不可解析或水平退化时回退世界基准。</p>
            </details>
          </details>

          <p v-if="hasTarget" class="ori-note">
            注视目标可解析时优先用目标方向；这里的手动 / 切线设置只在目标不可解析时回退使用。
          </p>
        </div>
      </details>

      <slot
        v-if="rollRow"
        name="row"
        :row="relabel(rollRow, '横滚（绕视线轴）')"
        :options="plainOptions"
        :axis="false"
      />
      <p class="ori-note">横滚在渲染期绕视线轴追加，不参与偏航 / 俯仰基准。</p>
    </div>
  </section>
</template>

<style scoped>
.ori-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ori-card__head {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.ori-card__title {
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
}

.ori-card__meta {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.ori-card__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ori-axis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 6px;
  min-width: 0;
}

.ori-axis__cell {
  min-width: 0;
}

.ori-fold,
.ori-angle {
  margin: 2px 0 0;
  padding: 2px 0;
  border-top: 1px dashed var(--border);
}

.ori-fold > summary,
.ori-angle > summary {
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.ori-base {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

.ori-note {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}
</style>
