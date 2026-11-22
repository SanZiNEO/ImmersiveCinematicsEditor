<script setup lang="ts">
/**
 * 属性行的动画控件（06-03 补充：对齐剪辑软件的参数行按钮组）。
 *
 * 语义来自 Olive `NodeParamViewKeyframeControl`（`nodeparamviewkeyframecontrol.cpp`）：
 *
 * | 按钮 | 图标 | 语义 |
 * |---|---|---|
 * | 上一个 | ‹ | 把播放头移到该属性上一个关键帧 |
 * | 菱形   | ◇/◆ | **播放头有帧 → 删该帧；无帧 → 建一帧**（可切换） |
 * | 下一个 | › | 把播放头移到该属性下一个关键帧 |
 * | 时钟   | ⏱ | 开/关该属性的动画（不是建帧） |
 *
 * 关键区别（源码 `ShowButtonsFromKeyframeEnable`）：‹ ◇ › 只在**已开动画**时可见，
 * 时钟永远可见。这样"有没有动画"和"这一时刻有没有帧"是两个独立的视觉状态。
 *
 * 本组件只发意图，写入由父组件走命令层。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** 该属性是否已有关键帧（= 动画已开启）。 */
  hasKeyframes: boolean
  /** 播放头是否精确命中该属性的一个关键帧。 */
  atKeyframe: boolean
  /** 该属性是否允许关键帧（`mode=value` / `struct` 为 false）。 */
  animatable: boolean
  /** 播放头时间（用于提示与可访问名）。 */
  playhead: number
  /** 是否有上一个/下一个关键帧。 */
  hasPrev: boolean
  hasNext: boolean
  /** 只读行（未知路径）：只显示状态，不可操作。 */
  readOnly?: boolean
  /** 紧凑模式（效果面板行高固定）。 */
  compact?: boolean
}>()

const emit = defineEmits<{
  /** 点菱形：`true` = 请求建帧，`false` = 请求删帧。 */
  toggle: [create: boolean]
  prev: []
  next: []
  /** 点时钟：`true` = 开启动画，`false` = 关闭动画。 */
  'toggle-animation': [enable: boolean]
}>()

const diamondTitle = computed(() => {
  if (props.readOnly === true) {
    return '未知路径只读'
  }
  if (!props.animatable) {
    return '该属性不支持关键帧'
  }
  return props.atKeyframe
    ? `删除 ${props.playhead.toFixed(2)}s 的关键帧`
    : `在 ${props.playhead.toFixed(2)}s 创建关键帧`
})

const clockTitle = computed(() => {
  if (props.readOnly === true) {
    return '未知路径只读'
  }
  if (!props.animatable) {
    return '该属性不支持关键帧'
  }
  return props.hasKeyframes ? '关闭动画（删除全部关键帧）' : '开启动画（在播放头建首帧）'
})

function onToggle(): void {
  if (props.readOnly === true || !props.animatable) {
    return
  }
  emit('toggle', !props.atKeyframe)
}

function onClock(): void {
  if (props.readOnly === true || !props.animatable) {
    return
  }
  emit('toggle-animation', !props.hasKeyframes)
}

function onPrev(): void {
  if (props.readOnly === true || !props.hasKeyframes) {
    return
  }
  emit('prev')
}

function onNext(): void {
  if (props.readOnly === true || !props.hasKeyframes) {
    return
  }
  emit('next')
}
</script>

<template>
  <span
    class="anim-ctl"
    :class="{ 'anim-ctl--compact': compact === true, 'anim-ctl--idle': !hasKeyframes }"
    role="group"
    aria-label="动画控件"
  >
    <!-- ‹ › ◇ 只在已开动画时可见（与 Olive 一致：没动画就没有帧可跳） -->
    <template v-if="hasKeyframes">
      <button
        type="button"
        class="anim-ctl__btn"
        :disabled="!hasPrev || readOnly === true"
        :title="hasPrev ? '上一个关键帧' : '前面没有关键帧'"
        aria-label="上一个关键帧"
        @click="onPrev"
      >‹</button>

      <button
        type="button"
        class="anim-ctl__btn anim-ctl__btn--diamond"
        :class="{ 'anim-ctl__btn--on': atKeyframe }"
        :disabled="!animatable || readOnly === true"
        :title="diamondTitle"
        :aria-pressed="atKeyframe"
        aria-label="切换当前时刻的关键帧"
        @click="onToggle"
      >{{ atKeyframe ? '◆' : '◇' }}</button>

      <button
        type="button"
        class="anim-ctl__btn"
        :disabled="!hasNext || readOnly === true"
        :title="hasNext ? '下一个关键帧' : '后面没有关键帧'"
        aria-label="下一个关键帧"
        @click="onNext"
      >›</button>
    </template>

    <button
      type="button"
      class="anim-ctl__btn anim-ctl__btn--clock"
      :class="{ 'anim-ctl__btn--on': hasKeyframes }"
      :disabled="!animatable || readOnly === true"
      :title="clockTitle"
      :aria-pressed="hasKeyframes"
      aria-label="切换动画"
      @click="onClock"
    >⏱</button>
  </span>
</template>

<style scoped>
.anim-ctl {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}

.anim-ctl__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 2px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.anim-ctl__btn:hover:enabled {
  background: var(--bg-hover);
  color: var(--text);
}

.anim-ctl__btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.anim-ctl__btn:disabled {
  color: var(--border-strong);
  cursor: not-allowed;
}

/* 菱形：未命中空心，命中实心并加色（与剪辑软件一致） */
.anim-ctl__btn--diamond {
  font-size: 12px;
}

.anim-ctl__btn--diamond.anim-ctl__btn--on {
  color: var(--accent);
}

.anim-ctl__btn--clock.anim-ctl__btn--on {
  color: var(--accent);
  border-color: var(--accent);
}

.anim-ctl--compact .anim-ctl__btn {
  min-width: 14px;
  width: 14px;
  height: 16px;
  padding: 0;
  font-size: 10px;
}

.anim-ctl--compact .anim-ctl__btn--diamond {
  font-size: 11px;
}
</style>
