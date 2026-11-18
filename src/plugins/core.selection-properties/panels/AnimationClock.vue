<script setup lang="ts">
/**
 * 动画时钟（06-09 §三）：属性面板里"开启动画"的唯一入口。
 *
 * 规则：
 * - 点击发 `object.enableAnimation`，在播放头建首帧；初值由命令层的回退链决定
 *   （同属性最近节点 → 显式静态值 → 目录默认值），本组件不自己算初值；
 * - 没有帧时文案是"添加首帧"，**不是**"关闭动画"：关闭动画只能在效果面板发起；
 * - 命令层说"没有可用的初值"时就地提示"请先输入静态值"，不假装成功；
 * - 成功后叶子进入效果面板（文档修订号变化后行自然消失），这里只报结果。
 *
 * 所有写入走 `ctx.commands.commit`。
 */
import { computed, ref } from 'vue'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'

const props = defineProps<{
  row: PropertyRow
  /** 播放头局部时间（片段局部秒）。 */
  playhead: number
  /** 不可用原因（`requires` 未满足 / 未知路径）：有值时禁用。 */
  disabledReason?: string
}>()

const emit = defineEmits<{
  /** 开启成功（外壳据此把焦点移到效果面板对应行）。 */
  enabled: [{ clipKey: string; path: string; time: number }]
  /** 失败（外壳可据此在行内显示消息；组件自己也会显示）。 */
  failed: [{ clipKey: string; path: string; message: string }]
}>()

const ctx = usePanelContext()
const error = ref('')
const notice = ref('')

const frameCount = computed(() => props.row.keyframes.length)
const hasFrames = computed(() => frameCount.value > 0)
const label = computed(() => (hasFrames.value ? '动画中' : '添加首帧'))
const disabled = computed(() => props.row.unknown || props.disabledReason !== undefined)

const title = computed(() => {
  if (props.row.unknown) {
    return '未知路径只读：不能开启动画'
  }
  if (props.disabledReason !== undefined) {
    return props.disabledReason
  }
  return hasFrames.value
    ? `该属性已有 ${frameCount.value} 帧（在效果面板编辑）`
    : `在播放头 t=${props.playhead.toFixed(3)}s 建首帧`
})

function enable(): void {
  if (disabled.value) {
    return
  }
  const outcome = ctx.commands.commit({
    kind: 'object.enableAnimation',
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: props.playhead,
  })
  if (!outcome.ok) {
    error.value = outcome.error ?? '开启动画被拒绝'
    notice.value = ''
    emit('failed', { clipKey: props.row.clipKey, path: props.row.path, message: error.value })
    return
  }
  error.value = ''
  notice.value = outcome.warnings.length > 0
    ? outcome.warnings.join('；')
    : `已在 t=${props.playhead.toFixed(3)}s 建首帧`
  emit('enabled', { clipKey: props.row.clipKey, path: props.row.path, time: props.playhead })
}
</script>

<template>
  <div class="clock">
    <button
      type="button"
      class="clock__button"
      :class="{ 'clock__button--on': hasFrames }"
      :disabled="disabled"
      :title="title"
      :aria-label="label"
      @click="enable"
    >
      <span class="clock__glyph" aria-hidden="true">{{ hasFrames ? '◉' : '○' }}</span>
      <span class="clock__label">{{ label }}</span>
    </button>
    <span v-if="hasFrames" class="clock__count">{{ frameCount }} 帧</span>
    <p v-if="error !== ''" class="clock__error" role="alert">{{ error }}</p>
    <p v-else-if="notice !== ''" class="clock__notice" role="status">{{ notice }}</p>
  </div>
</template>

<style scoped>
.clock {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.clock__button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.clock__button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.clock__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.clock__button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.clock__button--on {
  border-color: var(--accent);
  color: var(--accent);
}

.clock__glyph {
  font-size: 11px;
  line-height: 1;
}

.clock__count {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.clock__error {
  flex: 1 1 100%;
  margin: 0;
  color: var(--error);
  font-size: 11px;
}

.clock__notice {
  flex: 1 1 100%;
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
