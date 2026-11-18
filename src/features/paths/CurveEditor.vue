<script setup lang="ts">
/**
 * 跨轮契约组件（07-09 / README「对 08 的接口约定」）。
 *
 * - props：`{ value: JsonValue; disabled?: boolean }`
 * - emit：`change(value)`（受控：不改父值，只把编辑后的模型 JSON 回传）
 * - 内部按 11 种注册类型派生参数控件；chain / blend 递归编辑；
 *   未知类型 / 未知参数保留原文并给显式动作；错误与警告分区显示。
 *
 * 纯逻辑全部在 `curveEditorModel.ts`，本组件只渲染与转发。
 */
import { computed, defineComponent, h, shallowRef, watch, type VNode } from 'vue'
import type { JsonValue } from '../../core/doc/types.ts'
import {
  addChainChildOnRaw,
  applyRaw,
  cleanUnknownParamsOnRaw,
  convertUnknownToLinearOnRaw,
  createDraft,
  moveChainChildOnRaw,
  removeChainChildOnRaw,
  replaceBlendChildOnRaw,
  serializeDraft,
  setParamOnRaw,
  setTypeOnRaw,
  type DraftModel,
  type EditableNode,
} from './curveEditorModel.ts'
import { modelTypeList } from './modelEditor.ts'

type MutateFn = (op: (raw: JsonValue | undefined) => JsonValue | undefined) => void

const props = withDefaults(
  defineProps<{ value: JsonValue | undefined; disabled?: boolean }>(),
  { disabled: false },
)
const emit = defineEmits<{ change: [value: JsonValue | undefined] }>()

const draft = shallowRef<DraftModel>(createDraft(props.value))

watch(
  () => props.value,
  (next) => {
    draft.value = createDraft(next)
  },
  { deep: true },
)

function mutate(op: (raw: JsonValue | undefined) => JsonValue | undefined): void {
  if (props.disabled) {
    return
  }
  const next = op(draft.value.raw)
  draft.value = applyRaw(draft.value, next)
  emit('change', serializeDraft(draft.value))
}

const typeOptions = computed(() => modelTypeList())

function parseNumberOrUndefined(text: string): JsonValue | undefined {
  if (text.trim() === '') {
    return undefined
  }
  const number = Number(text)
  return Number.isFinite(number) ? number : undefined
}

function renderNode(node: EditableNode, disabled: boolean, onMutate: MutateFn): VNode {
  const children: VNode[] = []

  const select = h(
    'select',
    {
      class: 'curve-node__type',
      disabled,
      value: node.type,
      onChange: (event: Event) => {
        const target = event.target as HTMLSelectElement
        onMutate((raw) => setTypeOnRaw(raw, node.path, target.value))
      },
    },
    [
      ...typeOptions.value.map((type) => h('option', { key: type, value: type }, type)),
      node.type !== '' && !typeOptions.value.includes(node.type)
        ? h('option', { key: '__unknown', value: node.type, disabled: true }, `未知：${node.type}`)
        : null,
    ],
  )
  children.push(h('div', { class: 'curve-node__head' }, [
    h('span', { class: 'curve-node__path' }, node.path === '' ? '模型' : node.path),
    select,
  ]))

  for (const param of node.params) {
    if (param.paramType !== 'float') {
      continue
    }
    const text = param.value === undefined ? '' : String(param.value)
    children.push(
      h('label', { class: 'curve-param' }, [
        h('span', { class: 'curve-param__key' }, param.key),
        h('input', {
          class: 'curve-param__input',
          type: 'number',
          step: '0.05',
          disabled,
          value: text,
          onInput: (event: Event) => {
            const target = event.target as HTMLInputElement
            onMutate((raw) => setParamOnRaw(raw, node.path, param.key, parseNumberOrUndefined(target.value)))
          },
        }),
      ]),
    )
  }

  if (node.childKind === 'chain') {
    node.children.forEach((child, index) => {
      children.push(
        h('div', { class: 'curve-child' }, [
          h('div', { class: 'curve-child__controls' }, [
            h('button', {
              type: 'button',
              disabled: disabled || index === 0,
              onClick: () => onMutate((raw) => moveChainChildOnRaw(raw, node.path, index, -1)),
            }, '↑'),
            h('button', {
              type: 'button',
              disabled: disabled || index === node.children.length - 1,
              onClick: () => onMutate((raw) => moveChainChildOnRaw(raw, node.path, index, 1)),
            }, '↓'),
            h('button', {
              type: 'button',
              disabled,
              onClick: () => onMutate((raw) => removeChainChildOnRaw(raw, node.path, index)),
            }, '删'),
          ]),
          h(NodeView, { key: child.path, node: child, disabled, onMutate }),
        ]),
      )
    })
    children.push(
      h('button', {
        type: 'button',
        class: 'curve-add',
        disabled,
        onClick: () => onMutate((raw) => addChainChildOnRaw(raw, node.path)),
      }, '添加子模型'),
    )
  }

  if (node.childKind === 'blend') {
    for (const side of ['a', 'b'] as const) {
      const child = node.children.find((item) => item.path === side || item.path.endsWith(`.${side}`))
      children.push(
        h('div', { class: 'curve-child' }, [
          h('div', { class: 'curve-child__controls' }, [h('span', { class: 'curve-child__side' }, side)]),
          child !== undefined
            ? h(NodeView, { key: child.path, node: child, disabled, onMutate })
            : h('button', {
                type: 'button',
                disabled,
                onClick: () => onMutate((raw) => replaceBlendChildOnRaw(raw, node.path, side)),
              }, `添加 ${side} 分支`),
        ]),
      )
    }
  }

  const unknownType = node.type !== '' && !typeOptions.value.includes(node.type)
  if (unknownType) {
    children.push(
      h('button', {
        type: 'button',
        class: 'curve-action',
        disabled,
        onClick: () => onMutate((raw) => convertUnknownToLinearOnRaw(raw, node.path)),
      }, '转为 linear'),
    )
  }
  if (node.unknownKeys.length > 0) {
    children.push(
      h('button', {
        type: 'button',
        class: 'curve-action',
        disabled,
        onClick: () => onMutate((raw) => cleanUnknownParamsOnRaw(raw, node.path)),
      }, '清理未知参数'),
    )
  }

  for (const issue of node.issues) {
    children.push(
      h('div', { class: ['curve-issue', `curve-issue--${issue.severity}`] }, `${issue.field}: ${issue.message}`),
    )
  }

  return h('div', { class: ['curve-node', `curve-node--${node.childKind}`] }, children)
}

const NodeView = defineComponent({
  name: 'CurveEditorNode',
  props: {
    node: { type: Object, required: true },
    disabled: { type: Boolean, default: false },
  },
  emits: ['mutate'],
  setup(nodeProps, { emit }) {
    const node = nodeProps.node as EditableNode
    return () => renderNode(node, nodeProps.disabled, (op) => emit('mutate', op))
  },
})
</script>

<template>
  <div class="curve-editor" :class="{ 'is-disabled': disabled }">
    <NodeView :node="draft.root" :disabled="disabled" @mutate="mutate" />
  </div>
</template>

<style scoped>
.curve-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.curve-node {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.curve-node__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.curve-node__path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

.curve-node__type,
.curve-param__input {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 3px 6px;
}

.curve-param {
  display: flex;
  align-items: center;
  gap: 8px;
}

.curve-param__key {
  width: 120px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

.curve-param__input {
  flex: 1;
}

.curve-child {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 8px;
  border-left: 2px solid var(--border);
}

.curve-child__controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.curve-child__side {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

.curve-child__controls button,
.curve-add,
.curve-action {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}

.curve-add,
.curve-action {
  align-self: flex-start;
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.curve-issue {
  font-size: 11px;
  line-height: 1.4;
  padding: 4px 6px;
  border-radius: 4px;
}

.curve-issue--error {
  color: var(--error);
  background: var(--bg-raised);
}

.curve-issue--warn {
  color: var(--warning);
  background: var(--bg-raised);
}

.is-disabled {
  opacity: 0.7;
}
</style>
