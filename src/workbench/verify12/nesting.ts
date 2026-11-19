/**
 * 12 轮「嵌套传参」自检（12-02 / 12-16 嵌套组）。
 *
 * 覆盖：方向只能向下、环检测给闭环链、深度三层、重复次数整数与上限、总实例数上限、
 * 继承未声明参数拒绝、派生未登记拒绝、实例相互独立、产物不带中间命名空间 / 模板元信息。
 */
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'
import { expandTemplate, MAX_DEPTH, MAX_INSTANCES, MAX_REPEAT } from '../../features/templates/engine.ts'
import { internalById } from '../../features/templates/registry.ts'
import type { ClipDraft, InternalTemplate, LayerDraft, RefDecl } from '../../features/templates/model.ts'
import type { TemplateLayer } from '../../features/templates/types.ts'

function synthClip(id: string, layer: TemplateLayer = 'clip', trackType = 'CAMERA'): InternalTemplate {
  return {
    def: {
      id,
      layer,
      titleKey: `test.${id}.title`,
      descriptionKey: `test.${id}.desc`,
      targetTrackTypes: [trackType],
      params: [],
    },
    refs: [],
    expand(_params, ctx) {
      const clipId = ctx.nextClipId()
      const clip: ClipDraft = { clipId, trackType, start: 0, duration: 1, objects: {}, paths: [] }
      return { tracks: [], clips: [clip], paths: [], triggers: [] }
    },
  }
}

function synthParent(id: string, layer: TemplateLayer, refs: RefDecl[], params: string[]): InternalTemplate {
  return {
    def: {
      id,
      layer,
      titleKey: `test.${id}.title`,
      descriptionKey: `test.${id}.desc`,
      targetTrackTypes: ['CAMERA'],
      params: params.map((key) => ({ key, kind: 'integer' as const, labelKey: `test.${key}`, required: false, default: 1 })),
    },
    refs,
    expand(): LayerDraft {
      return { tracks: [], clips: [], paths: [], triggers: [] }
    },
  }
}

export function runNesting(check: CheckFn, ctx: VerifyContext): void {
  const synthetic = new Map<string, InternalTemplate>()
  const resolve = (id: string): InternalTemplate | null => internalById(id) ?? synthetic.get(id) ?? null

  // ── 方向：片段不能引用轨道 / 脚本（同层或上层）。 ──
  const upChild = synthClip('nest.upChild', 'track')
  const upParent = synthParent('nest.upParent', 'clip', [{ target: 'nest.upChild', repeat: 1, bindings: {} }], [])
  synthetic.set(upChild.def.id, upChild)
  synthetic.set(upParent.def.id, upParent)
  const upResult = expandTemplate(upParent, {}, resolve, ctx.catalog)
  check('N1 方向向上拒绝', upResult.diagnostics.some((d) => d.code === 'T_NEST_DIRECTION'), upResult.diagnostics)

  // ── 环：a → b → a，诊断带闭环链。 ──
  const cycleB = synthClip('nest.cycleB')
  const cycleA = synthParent('nest.cycleA', 'track', [{ target: 'nest.cycleB', repeat: 1, bindings: {} }], [])
  cycleB.refs = [{ target: 'nest.cycleA', repeat: 1, bindings: {} }]
  synthetic.set(cycleA.def.id, cycleA)
  synthetic.set(cycleB.def.id, cycleB)
  const cycleResult = expandTemplate(cycleA, {}, resolve, ctx.catalog)
  const cycleDiag = cycleResult.diagnostics.find((d) => d.code === 'T_NEST_CYCLE')
  check('N2 引用成环拒绝', cycleDiag !== null && cycleDiag !== undefined, cycleResult.diagnostics)
  check('N2 闭环链完整', cycleDiag?.refChain?.join('>') === 'nest.cycleA>nest.cycleB>nest.cycleA', cycleDiag?.refChain)

  // ── 深度：四层链超出固定三层上限（clip → track → script → clip）。 ──
  const depthC = synthClip('nest.depthC', 'clip')
  const depthB = synthParent('nest.depthB', 'script', [{ target: 'nest.depthC', repeat: 1, bindings: {} }], [])
  const depthA = synthParent('nest.depthA', 'track', [{ target: 'nest.depthB', repeat: 1, bindings: {} }], [])
  const depthTop = synthParent('nest.depthTop', 'clip', [{ target: 'nest.depthA', repeat: 1, bindings: {} }], [])
  synthetic.set(depthA.def.id, depthA)
  synthetic.set(depthB.def.id, depthB)
  synthetic.set(depthC.def.id, depthC)
  synthetic.set(depthTop.def.id, depthTop)
  const depthResult = expandTemplate(depthTop, {}, resolve, ctx.catalog)
  check(`N3 深度超过 ${MAX_DEPTH} 层拒绝`, depthResult.diagnostics.some((d) => d.code === 'T_NEST_DEPTH'), depthResult.diagnostics)

  // ── 重复次数：非整数拒绝、越界拒绝。 ──
  const repChild = synthClip('nest.repChild')
  synthetic.set(repChild.def.id, repChild)
  const nonInteger = synthParent(
    'nest.repFloat', 'track',
    [{ target: 'nest.repChild', repeatParam: 'count', bindings: {} }],
    ['count'],
  )
  synthetic.set(nonInteger.def.id, nonInteger)
  const floatResult = expandTemplate(nonInteger, { count: 1.5 }, resolve, ctx.catalog)
  check('N4 重复次数非整数拒绝', floatResult.diagnostics.some((d) => d.code === 'T_NEST_REPEAT_TYPE'), floatResult.diagnostics)

  const zeroRep = synthParent(
    'nest.repZero', 'track',
    [{ target: 'nest.repChild', repeatParam: 'count', bindings: {} }],
    ['count'],
  )
  synthetic.set(zeroRep.def.id, zeroRep)
  const zeroResult = expandTemplate(zeroRep, { count: 0 }, resolve, ctx.catalog)
  check(`N4 重复次数小于 1 拒绝`, zeroResult.diagnostics.some((d) => d.code === 'T_NEST_REPEAT_RANGE'), zeroResult.diagnostics)

  const overRep = synthParent(
    'nest.repOver', 'track',
    [{ target: 'nest.repChild', repeatParam: 'count', bindings: {} }],
    ['count'],
  )
  synthetic.set(overRep.def.id, overRep)
  const overResult = expandTemplate(overRep, { count: MAX_REPEAT + 1 }, resolve, ctx.catalog)
  check(`N4 重复次数超过 ${MAX_REPEAT} 拒绝`, overResult.diagnostics.some((d) => d.code === 'T_NEST_REPEAT_RANGE'), overResult.diagnostics)

  // ── 总实例数上限：两条引用各 32 实例，合计超过上限。 ──
  const limitParent = synthParent(
    'nest.limit', 'track',
    [
      { target: 'nest.repChild', repeat: 32, bindings: {} },
      { target: 'nest.repChild', repeat: 32, bindings: {} },
    ],
    [],
  )
  synthetic.set(limitParent.def.id, limitParent)
  const limitResult = expandTemplate(limitParent, {}, resolve, ctx.catalog)
  check(`N5 总实例数超过 ${MAX_INSTANCES} 拒绝`, limitResult.diagnostics.some((d) => d.code === 'T_NEST_INSTANCE_LIMIT'), limitResult.diagnostics)

  // ── 继承未声明参数拒绝。 ──
  const inheritParent = synthParent(
    'nest.inherit', 'track',
    [{ target: 'nest.repChild', repeat: 1, bindings: { pose: { form: 'inherit', fromParam: 'ghost' } } }],
    ['count'],
  )
  synthetic.set(inheritParent.def.id, inheritParent)
  const inheritResult = expandTemplate(inheritParent, {}, resolve, ctx.catalog)
  check('N6 继承未声明参数拒绝', inheritResult.diagnostics.some((d) => d.code === 'T_NEST_INHERIT_UNDECLARED'), inheritResult.diagnostics)

  // ── 派生未登记拒绝。 ──
  const deriveParent = synthParent(
    'nest.derive', 'track',
    [{ target: 'nest.repChild', repeat: 1, bindings: { pose: { form: 'derive', derive: { name: 'notRegistered', args: {} } } } }],
    [],
  )
  synthetic.set(deriveParent.def.id, deriveParent)
  const deriveResult = expandTemplate(deriveParent, {}, resolve, ctx.catalog)
  check('N6 未登记派生拒绝', deriveResult.diagnostics.some((d) => d.code === 'T_NEST_DERIVE_UNKNOWN'), deriveResult.diagnostics)

  // ── 正向：两个实例相互独立，id 互不相同，产物无模板元信息泄漏。 ──
  const happyChild = synthClip('nest.happyChild')
  const happyParent = synthParent(
    'nest.happyParent', 'track',
    [{ target: 'nest.happyChild', repeat: 2, bindings: {} }],
    [],
  )
  synthetic.set(happyChild.def.id, happyChild)
  synthetic.set(happyParent.def.id, happyParent)
  const happyResult = expandTemplate(happyParent, {}, resolve, ctx.catalog)
  check('N7 正向展开无诊断', happyResult.diagnostics.length === 0, happyResult.diagnostics)
  const happyClips = happyResult.draft.clips
  check('N7 两个实例各产一片段', happyClips.length === 2, happyClips.length)
  check('N7 实例 id 互不相同', new Set(happyClips.map((c) => c.clipId)).size === 2, happyClips.map((c) => c.clipId))
  const leakKeys = happyClips.flatMap((clip) => Object.keys(clip.objects))
  check('N7 产物对象不带模板 / 参数 / 槽位 / 命名空间键', leakKeys.length === 0, leakKeys)
  const idPattern = /^[A-Za-z0-9_]{1,64}$/
  check('N7 片段 id 符合白名单', happyClips.every((c) => idPattern.test(c.clipId)), happyClips.map((c) => c.clipId))
}
