/** 数学模型：`MathModelRegistry` 的 11 种类型、参数声明、值域与递归上限。 */
import type { FieldEntry } from '../types.ts'

/**
 * 模型参数的公共外壳：段 / 作用域 / 分组固定为模型目录，类型与缺省值逐条对应
 * `MathModelRegistry` 的 `*_PARAMS` 常量；`FieldDef` 两参构造 → 非必填、分组 `info`。
 */
function modelParam(
  model: string,
  key: string,
  type: FieldEntry['type'],
  defaultValue: unknown,
  sourceRef: string,
): FieldEntry {
  return {
    id: `model.${model}.${key}`,
    segment: 'models',
    scope: [model],
    key,
    type,
    default: defaultValue,
    hasDefault: defaultValue !== null,
    required: false,
    section: 'info',
    sourceRef,
  }
}

/** 模型类型列表，顺序 = `MathModelRegistry` 静态块注册顺序。 */
export const MODEL_TYPES: readonly string[] = [
  'linear',
  'smoothstep',
  'ease_in',
  'ease_out',
  'ease_in_out',
  'cubic_bezier',
  'exponential_smooth',
  'spring',
  'inertia',
  'chain',
  'blend',
]

/** 每种模型的参数表，顺序 = 各 `*_PARAMS` 常量的键顺序（= 编辑器表单顺序）。 */
export const MODEL_PARAMS: Record<string, FieldEntry[]> = {
  linear: [],
  smoothstep: [],
  ease_in: [],
  ease_out: [],
  ease_in_out: [],
  cubic_bezier: [
    modelParam('cubic_bezier', 'x1', 'float', 1 / 3, 'MathModelRegistry#CUBIC_BEZIER_PARAMS:78'),
    modelParam('cubic_bezier', 'y1', 'float', 1 / 3, 'MathModelRegistry#CUBIC_BEZIER_PARAMS:78'),
    modelParam('cubic_bezier', 'x2', 'float', 2 / 3, 'MathModelRegistry#CUBIC_BEZIER_PARAMS:78'),
    modelParam('cubic_bezier', 'y2', 'float', 2 / 3, 'MathModelRegistry#CUBIC_BEZIER_PARAMS:78'),
  ],
  exponential_smooth: [
    modelParam('exponential_smooth', 'tau', 'float', 0.15, 'MathModelRegistry#EXPONENTIAL_SMOOTH_PARAMS:84'),
  ],
  spring: [
    modelParam('spring', 'stiffness', 'float', 8, 'MathModelRegistry#SPRING_PARAMS:87'),
    modelParam('spring', 'damping', 'float', 0.75, 'MathModelRegistry#SPRING_PARAMS:87'),
    modelParam('spring', 'initial_velocity', 'float', 0, 'MathModelRegistry#SPRING_PARAMS:87'),
  ],
  inertia: [
    modelParam('inertia', 'stiffness', 'float', 8, 'MathModelRegistry#INERTIA_PARAMS:92'),
    modelParam('inertia', 'damping', 'float', 0.75, 'MathModelRegistry#INERTIA_PARAMS:92'),
    modelParam('inertia', 'initial_velocity', 'float', 0, 'MathModelRegistry#INERTIA_PARAMS:92'),
  ],
  chain: [modelParam('chain', 'models', 'model_list', null, 'MathModelRegistry#CHAIN_PARAMS:97')],
  blend: [
    modelParam('blend', 'a', 'model', null, 'MathModelRegistry#BLEND_PARAMS:100'),
    modelParam('blend', 'b', 'model', null, 'MathModelRegistry#BLEND_PARAMS:100'),
    modelParam('blend', 'weight', 'float', 0.5, 'MathModelRegistry#BLEND_PARAMS:100'),
  ],
}

/** 值域名，顺序 = `ValueDomain` 枚举声明顺序（`math/ValueDomain.java:10`），取各常量的 `key()`（小写）。 */
export const MODEL_DOMAINS: readonly string[] = ['scalar', 'angle', 'vector', 'color']

/** 定义树深度上限（含根 = 1）：`MathModelRegistry.MODEL_MAX_DEPTH`（`MathModelRegistry.java:51`）。 */
export const MODEL_MAX_DEPTH = 8
/** 单定义节点数上限：`MathModelRegistry.MODEL_MAX_NODES`（`MathModelRegistry.java:54`）。 */
export const MODEL_MAX_NODES = 32
/** 未注册 / 缺失 / 非法定义的回落类型：`MathModelRegistry.DEFAULT_TYPE`（`MathModelRegistry.java:48`）。 */
export const MODEL_FALLBACK = 'linear'
