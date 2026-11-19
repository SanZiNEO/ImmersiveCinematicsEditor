/**
 * 嵌套展开引擎（12-02）。
 *
 * 约束：深度固定三层、方向只能向下、栈内重复 id 报环并给闭环链；重复次数整数与上限、
 * 总实例数上限；引用声明三种绑定形态（常量 / 上层同名参数 / 登记在册的封闭派生）；
 * 命名空间与最终 id 分配在本层完成；展开期参数只读，产物不带任何模板元信息。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import { diagnosticOf, type Diagnostic } from '../generation/diagnostics.ts'
import type { ParamValue, TemplateLayer } from './types.ts'
import {
  createIdAllocator,
  draftClips,
  emptyDraft,
  mergeDraft,
  type ExpandContext,
  type InternalTemplate,
  type LayerDraft,
  type RefDecl,
} from './model.ts'
import { derivationByName } from './derivations.ts'

/** 最大嵌套深度（含根层）：片段 → 轨道 → 脚本三层。 */
export const MAX_DEPTH = 3
/** 单条引用最大重复次数。 */
export const MAX_REPEAT = 32
/** 一次展开总实例（子模板展开次数）上限。 */
export const MAX_INSTANCES = 64

const LAYER_ORDER: Record<TemplateLayer, number> = { clip: 0, track: 1, script: 2 }

/**
 * 每次顶层展开（一次「应用模板」）递增的根命名空间序号。
 *
 * 同一文档上连续应用多个模板时，片段 / 路径 id 必须相互唯一；根命名空间按应用次数
 * 递进（`t0`、`t1`…），避免两次展开都从 `t0c1` 起步而撞 id（L18 重复片段 id）。
 */
let applyNamespaceSeq = 0

export interface EngineResult {
  draft: LayerDraft
  diagnostics: Diagnostic[]
}

type Resolver = (id: string) => InternalTemplate | null

/** 静态引用校验：目标存在、方向向下、绑定可解析、派生在册。 */
export function validateReferences(
  internal: InternalTemplate,
  resolve: Resolver,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const declared = new Set(internal.def.params.map((param) => param.key))

  // 静态深度遍历：路径达到上限即报 T_NEST_DEPTH（环由栈内重复单独识别）。
  const checkDepth = (node: InternalTemplate, path: string[]): void => {
    if (path.length >= MAX_DEPTH) {
      diagnostics.push(diagnosticOf(
        'T_NEST_DEPTH', 'error', `嵌套深度超过 ${MAX_DEPTH} 层`,
        'template', { templateId: node.def.id, refChain: [...path] },
      ))
      return
    }
    for (const ref of node.refs) {
      const target = resolve(ref.target)
      if (target === null) continue
      if (path.includes(target.def.id)) continue
      checkDepth(target, [...path, node.def.id])
    }
  }
  checkDepth(internal, [])

  for (const ref of internal.refs) {
    const target = resolve(ref.target)
    const loc = { templateId: internal.def.id, refChain: [internal.def.id, ref.target] }
    if (target === null) {
      diagnostics.push(diagnosticOf('T_NEST_UNKNOWN_TARGET', 'error', `引用的模板 ${ref.target} 未登记`, 'template', loc))
      continue
    }
    if (LAYER_ORDER[target.def.layer] >= LAYER_ORDER[internal.def.layer]) {
      diagnostics.push(diagnosticOf(
        'T_NEST_DIRECTION', 'error',
        `模板 ${internal.def.id}（${internal.def.layer}）只能向下引用，不能引用同层或上层的 ${target.def.layer} 模板`,
        'template', loc,
      ))
    }
    if (ref.repeatParam !== undefined && !declared.has(ref.repeatParam)) {
      diagnostics.push(diagnosticOf(
        'T_NEST_INHERIT_UNDECLARED', 'error',
        `重复次数参数 ${ref.repeatParam} 未在模板 ${internal.def.id} 中声明`,
        'template', { ...loc, paramKey: ref.repeatParam },
      ))
    }
    for (const [childKey, binding] of Object.entries(ref.bindings)) {
      if (binding.form === 'inherit') {
        if (binding.fromParam === undefined || !declared.has(binding.fromParam)) {
          diagnostics.push(diagnosticOf(
            'T_NEST_INHERIT_UNDECLARED', 'error',
            `绑定 ${childKey} 继承的上层参数 ${binding.fromParam ?? '?'} 未声明`,
            'template', loc,
          ))
        }
      } else if (binding.form === 'derive') {
        const derive = binding.derive
        if (derive === undefined) {
          diagnostics.push(diagnosticOf(
            'T_NEST_DERIVE_UNKNOWN', 'error', '派生未登记在册',
            'template', loc,
          ))
          continue
        }
        const registered = derivationByName(derive.name)
        if (registered === null) {
          diagnostics.push(diagnosticOf(
            'T_NEST_DERIVE_UNKNOWN', 'error',
            `派生 ${derive.name} 未登记在册`,
            'template', loc,
          ))
          continue
        }
        for (const arg of registered.args) {
          if (!Object.prototype.hasOwnProperty.call(derive.args, arg)) {
            diagnostics.push(diagnosticOf(
              'T_NEST_DERIVE_ARG_MISSING', 'error',
              `派生 ${derive.name} 缺少参数 ${arg}`,
              'template', loc,
            ))
          }
        }
      }
    }
  }
  return diagnostics
}

function repeatCount(ref: RefDecl, params: Record<string, ParamValue>): number | null {
  if (ref.repeatParam !== undefined) {
    const raw = params[ref.repeatParam]
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      return null
    }
    return raw
  }
  return typeof ref.repeat === 'number' ? ref.repeat : null
}

function resolveBinding(
  binding: RefDecl['bindings'][string],
  params: Record<string, ParamValue>,
  index: number,
  count: number,
): ParamValue {
  if (binding.form === 'constant') {
    return binding.constant ?? null
  }
  if (binding.form === 'inherit') {
    return binding.fromParam !== undefined ? params[binding.fromParam] ?? null : null
  }
  const derive = binding.derive
  if (derive === undefined) {
    return null
  }
  const registered = derivationByName(derive.name)
  if (registered === null) {
    return null
  }
  return registered.compute(derive.args, index, count)
}

interface WalkState {
  resolve: Resolver
  catalog: CatalogIndex
  diagnostics: Diagnostic[]
  instances: number
}

function walk(
  internal: InternalTemplate,
  params: Record<string, ParamValue>,
  stack: string[],
  namespace: string,
  refIndex: number,
  instance: number,
  state: WalkState,
  draft: LayerDraft,
): boolean {
  if (stack.length >= MAX_DEPTH) {
    state.diagnostics.push(diagnosticOf(
      'T_NEST_DEPTH', 'error', `嵌套深度超过 ${MAX_DEPTH} 层`,
      'template', { templateId: internal.def.id, refChain: [...stack] },
    ))
    return false
  }
  const alloc = createIdAllocator(namespace)
  const ctx: ExpandContext = {
    catalog: state.catalog,
    namespace,
    refIndex,
    instance,
    nextClipId: alloc.nextClipId,
    nextPathId: alloc.nextPathId,
  }

  let own: LayerDraft
  try {
    own = internal.expand(params, ctx)
  } catch (error) {
    state.diagnostics.push(diagnosticOf(
      'T_EXPAND_FAILED', 'error', `模板 ${internal.def.id} 展开失败`,
      'template', { templateId: internal.def.id, detail: error instanceof Error ? error.message : String(error) },
    ))
    return false
  }
  mergeDraft(draft, own)

  for (let refIndexPos = 0; refIndexPos < internal.refs.length; refIndexPos += 1) {
    const ref = internal.refs[refIndexPos]
    const target = state.resolve(ref.target)
    if (target === null) {
      state.diagnostics.push(diagnosticOf(
        'T_NEST_UNKNOWN_TARGET', 'error', `引用的模板 ${ref.target} 未登记`,
        'template', { templateId: internal.def.id, refChain: [...stack, ref.target] },
      ))
      return false
    }
    const chainSoFar = [...stack, internal.def.id]
    if (chainSoFar.includes(ref.target)) {
      const cycleStart = chainSoFar.indexOf(ref.target)
      const chain = [...chainSoFar.slice(cycleStart), ref.target]
      state.diagnostics.push(diagnosticOf(
        'T_NEST_CYCLE', 'error', `模板引用成环：${chain.join(' → ')}`,
        'template', { templateId: internal.def.id, refChain: chain },
      ))
      return false
    }
    const count = repeatCount(ref, params)
    if (count === null) {
      state.diagnostics.push(diagnosticOf(
        'T_NEST_REPEAT_TYPE', 'error', `模板 ${ref.target} 的重复次数必须是整数`,
        'template', { templateId: internal.def.id, refChain: [...stack, ref.target] },
      ))
      return false
    }
    if (count < 1 || count > MAX_REPEAT) {
      state.diagnostics.push(diagnosticOf(
        'T_NEST_REPEAT_RANGE', 'error', `模板 ${ref.target} 的重复次数须在 1~${MAX_REPEAT} 之间`,
        'template', { templateId: internal.def.id, refChain: [...stack, ref.target] },
      ))
      return false
    }
    for (let i = 0; i < count; i += 1) {
      state.instances += 1
      if (state.instances > MAX_INSTANCES) {
        state.diagnostics.push(diagnosticOf(
          'T_NEST_INSTANCE_LIMIT', 'error', `一次生成的实例数超过上限 ${MAX_INSTANCES}`,
          'template', { templateId: internal.def.id, refChain: [...stack, ref.target] },
        ))
        return false
      }
      const childParams: Record<string, ParamValue> = {}
      for (const [childKey, binding] of Object.entries(ref.bindings)) {
        childParams[childKey] = resolveBinding(binding, params, i, count)
      }
      const childNamespace = `${namespace}_r${refIndexPos}_i${i}`
      const ok = walk(
        target,
        childParams,
        [...stack, internal.def.id],
        childNamespace,
        refIndexPos,
        i,
        state,
        draft,
      )
      if (!ok) {
        return false
      }
    }
  }
  return true
}

/** 展开根模板：静态引用校验通过后递归展开，返回合并草稿与诊断。 */
export function expandTemplate(
  root: InternalTemplate,
  params: Record<string, ParamValue>,
  resolve: Resolver,
  catalog: CatalogIndex,
): EngineResult {
  const diagnostics: Diagnostic[] = [...validateReferences(root, resolve)]
  if (diagnostics.some((item) => item.severity === 'error')) {
    return { draft: emptyDraft(), diagnostics }
  }
  const state: WalkState = { resolve, catalog, diagnostics, instances: 1 }
  const draft = emptyDraft()
  const namespace = `t${applyNamespaceSeq}`
  applyNamespaceSeq += 1
  const ok = walk(root, params, [], namespace, 0, 0, state, draft)
  if (!ok) {
    return { draft: emptyDraft(), diagnostics }
  }
  void draftClips
  return { draft, diagnostics }
}
