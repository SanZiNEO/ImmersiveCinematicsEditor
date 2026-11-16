/** 路径曲线：`PathCurveRegistry` 的 11 种曲线、能力集合与参数声明。 */
import type { CurveCapability, CurveParamEntry, ParamKind } from '../types.ts'

/**
 * 曲线参数的公共外壳：`kind` 用 `PathParamKind` 原样大写名，`hasDefault` 由 `defaultValue !== null`
 * 决定（与 `PathParamDef` 的 `defaultValue` 语义一致），枚举仅在非空时写出。
 */
function param(
  key: string,
  kind: ParamKind,
  defaultValue: unknown,
  required: boolean,
  sourceRef: string,
  doc: string,
  enumValues?: string[],
): CurveParamEntry {
  const entry: CurveParamEntry = {
    key,
    kind,
    default: defaultValue,
    hasDefault: defaultValue !== null,
    required,
    doc,
    sourceRef,
  }
  if (enumValues !== undefined && enumValues.length > 0) {
    entry.enumValues = enumValues
  }
  return entry
}

/** 曲线类型列表，顺序 = `PathCurveRegistry` 静态块注册顺序。 */
export const CURVE_TYPES: readonly string[] = [
  'linear',
  'bezier',
  'rational_bezier',
  'arc',
  'ellipse',
  'bspline',
  'nurbs',
  'catmull_rom',
  'hermite',
  'clothoid',
  'fourier',
]

/** 每种曲线声明的能力集合，元素为 `PathCapability` 原样枚举名。 */
export const CURVE_CAPABILITIES: Record<string, CurveCapability[]> = {
  linear: [],
  bezier: ['ANALYTIC_SECOND_DERIVATIVE'],
  rational_bezier: ['ANALYTIC_SECOND_DERIVATIVE'],
  arc: ['ANALYTIC_ARC_LENGTH', 'ANALYTIC_SECOND_DERIVATIVE'],
  ellipse: ['ANALYTIC_SECOND_DERIVATIVE'],
  bspline: ['ANALYTIC_SECOND_DERIVATIVE', 'KNOT_VECTOR'],
  nurbs: ['ANALYTIC_SECOND_DERIVATIVE', 'RATIONAL_WEIGHTS', 'KNOT_VECTOR'],
  catmull_rom: ['ANALYTIC_SECOND_DERIVATIVE'],
  hermite: ['ANALYTIC_SECOND_DERIVATIVE'],
  clothoid: ['ANALYTIC_ARC_LENGTH', 'ANALYTIC_SECOND_DERIVATIVE'],
  fourier: ['ANALYTIC_SECOND_DERIVATIVE', 'PERIODIC'],
}

/** 每种曲线的参数表，顺序 = `register` 调用里的 `PathParamDef` 顺序。 */
export const CURVE_PARAMS: Record<string, CurveParamEntry[]> = {
  linear: [],
  bezier: [
    param('control_points', 'POINT_LIST', null, true, 'PathCurveRegistry#register:64',
      '两个内部控制点，相对段起点用 dx/dy/dz，绝对用 x/y/z'),
  ],
  rational_bezier: [
    param('control_points', 'POINT_LIST', null, true, 'PathCurveRegistry#register:68',
      '内部控件点：1 个 = 二次，2 个 = 三次；相对段起点用 dx/dy/dz，绝对用 x/y/z'),
    param('weights', 'NUMBER_LIST', null, true, 'PathCurveRegistry#register:68',
      '与 control_points 等长的内部权重（无量纲），每项必须是有限正数；端点权重恒为 1'),
  ],
  arc: [
    param('center', 'POINT', null, true, 'PathCurveRegistry#register:75',
      '圆心；相对段起点用 dx/dy/dz，绝对用 x/y/z（世界单位）'),
    param('radius', 'NUMBER', null, true, 'PathCurveRegistry#register:75',
      '半径（世界单位，有限正数）'),
    param('start_angle', 'NUMBER', null, true, 'PathCurveRegistry#register:75',
      '起始角（度）'),
    param('end_angle', 'NUMBER', null, true, 'PathCurveRegistry#register:75',
      '结束角（度），跨度非零且 |Δ| ≤ 360'),
    param('normal', 'VECTOR', { x: 0, y: 1, z: 0 }, false, 'PathCurveRegistry#register:75',
      '圆弧所在平面的法向 {x,y,z}（世界轴，缺省 (0,1,0)），不得与 reference_axis 平行'),
    param('reference_axis', 'VECTOR', { x: 1, y: 0, z: 0 }, false, 'PathCurveRegistry#register:75',
      '起始角 0 的方向 {x,y,z}（世界轴，缺省 (1,0,0)）'),
  ],
  ellipse: [
    param('center', 'POINT', null, true, 'PathCurveRegistry#register:97',
      '圆心；相对段起点用 dx/dy/dz，绝对用 x/y/z（世界单位）'),
    param('semi_major', 'NUMBER', null, true, 'PathCurveRegistry#register:97',
      '长半轴（世界单位，有限正数）'),
    param('semi_minor', 'NUMBER', null, true, 'PathCurveRegistry#register:97',
      '短半轴（世界单位，有限正数）'),
    param('rotation', 'NUMBER', 0, false, 'PathCurveRegistry#register:97',
      '长短轴在法向平面内的旋转（度，缺省 0）'),
    param('start_angle', 'NUMBER', null, true, 'PathCurveRegistry#register:97',
      '起始参数角（度，单位圆参数角而非几何极角）'),
    param('end_angle', 'NUMBER', null, true, 'PathCurveRegistry#register:97',
      '结束参数角（度），跨度非零且 |Δ| ≤ 360'),
    param('normal', 'VECTOR', { x: 0, y: 1, z: 0 }, false, 'PathCurveRegistry#register:97',
      '椭圆所在平面的法向 {x,y,z}（世界轴，缺省 (0,1,0)），不得与 reference_axis 平行'),
    param('reference_axis', 'VECTOR', { x: 1, y: 0, z: 0 }, false, 'PathCurveRegistry#register:97',
      '参数角 0 的方向 {x,y,z}（世界轴，缺省 (1,0,0)）'),
  ],
  bspline: [
    param('control_points', 'POINT_LIST', null, true, 'PathCurveRegistry#register:124',
      '内部控制点（不含端点），端点由关键帧给出'),
    param('degree', 'INTEGER', 3, false, 'PathCurveRegistry#register:124',
      'B-spline 次数（1 ~ 控制点数-1；缺省 3）'),
    param('knots', 'NUMBER_LIST', null, false, 'PathCurveRegistry#register:124',
      '可选节点向量：长度必须为 控制点数+次数+1，非减且跨度为正；缺省钳制均匀节点'),
  ],
  nurbs: [
    param('control_points', 'POINT_LIST', null, true, 'PathCurveRegistry#register:138',
      '内部控制点（不含端点）'),
    param('weights', 'NUMBER_LIST', null, true, 'PathCurveRegistry#register:138',
      '内部权重，端点权重恒为 1'),
    param('degree', 'INTEGER', 3, false, 'PathCurveRegistry#register:138',
      'NURBS 次数（1 ~ 控制点数-1；缺省 3）'),
    param('knots', 'NUMBER_LIST', null, false, 'PathCurveRegistry#register:138',
      '可选节点向量：长度必须为 控制点数+次数+1，非减且跨度为正；缺省钳制均匀节点'),
  ],
  catmull_rom: [
    param('points', 'POINT_LIST', null, true, 'PathCurveRegistry#register:155',
      '内部过点（不含端点），端点由关键帧给出'),
    param('parameterization', 'ENUM', 'centripetal', false, 'PathCurveRegistry#register:155',
      '参数化：uniform（α=0）/ chordal（α=1）/ centripetal（α=0.5，缺省）',
      ['uniform', 'chordal', 'centripetal']),
    param('tension', 'NUMBER', 1, false, 'PathCurveRegistry#register:155',
      '张力（0 ~ 1，缺省 1.0）：乘在 Barry–Goldman 切线上，0 = 切线全零'),
    param('endpoint', 'ENUM', 'mirror', false, 'PathCurveRegistry#register:155',
      '端点幽灵点策略：mirror（镜像，缺省）/ clamp（重复端点）',
      ['mirror', 'clamp']),
  ],
  hermite: [
    param('tangents', 'POINT_LIST', null, true, 'PathCurveRegistry#register:171',
      '两端切线；relative 为从各自端点出发的方向向量'),
  ],
  clothoid: [
    param('start_curvature', 'NUMBER', null, true, 'PathCurveRegistry#register:175',
      '起点曲率 1/方块，负值=反向'),
    param('end_curvature', 'NUMBER', null, true, 'PathCurveRegistry#register:175',
      '终点曲率 1/方块'),
    param('length', 'NUMBER', null, true, 'PathCurveRegistry#register:175',
      '弧长（方块），必须 > 0'),
    param('start_direction', 'VECTOR', { x: 1, y: 0, z: 0 }, false, 'PathCurveRegistry#register:175',
      '起点切线方向 {x,y,z}（世界轴，缺省 (1,0,0)）'),
    param('normal', 'VECTOR', { x: 0, y: 1, z: 0 }, false, 'PathCurveRegistry#register:175',
      '过渡平面法向 {x,y,z}（世界轴，缺省 (0,1,0)），不得与 start_direction 平行'),
  ],
  fourier: [
    param('a0', 'VECTOR', { x: 0, y: 0, z: 0 }, false, 'PathCurveRegistry#register:195',
      '常数项 a0 {x,y,z}（缺省 (0,0,0)）；非周期形式必须为 0'),
    param('cos', 'POINT_LIST', null, false, 'PathCurveRegistry#register:195',
      '余弦系数 a_k（第 k 项 = 阶数 k；{dx,dy,dz} 与 {x,y,z} 数值等价，系数是偏移量）'),
    param('sin', 'POINT_LIST', null, false, 'PathCurveRegistry#register:195',
      '正弦系数 b_k（与 cos 等长）'),
    param('period', 'NUMBER', null, true, 'PathCurveRegistry#register:195',
      '参数周期 T（u 单位），必须 > 0'),
    param('periodic', 'BOOLEAN', true, false, 'PathCurveRegistry#register:195',
      'true = 周期级数（锚点 FREE，忽略关键帧端点）；false = 三次趋势 + 受约束残差'),
    param('start_velocity', 'VECTOR', { x: 0, y: 0, z: 0 }, false, 'PathCurveRegistry#register:195',
      '起点速度 V0（位置 / u），仅 periodic=false 生效'),
    param('end_velocity', 'VECTOR', { x: 0, y: 0, z: 0 }, false, 'PathCurveRegistry#register:195',
      '终点速度 V1（位置 / u），仅 periodic=false 生效'),
  ],
}
