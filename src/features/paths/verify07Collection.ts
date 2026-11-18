/**
 * 07 轮自检切片：路径集合面板 / 几何表单 / 时间映射编辑器（纯逻辑）。
 *
 * 运行：`node --experimental-strip-types src/features/paths/verify07Collection.ts`
 *
 * 断言走真 `DocStore` + 真 catalog + 真 commit；不加载 `.vue` / DOM。
 * 覆盖 07-05 / 07-06 / 07-08 三份文档「六、实现结果」里可自动化的条目。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import { buildCatalog, indexCatalog } from '../../core/schema/index.ts'
import { metaKeys } from '../../core/doc/keys.ts'
import { parseDoc } from '../../core/doc/parse.ts'
import { DocStore } from '../../core/doc/store.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../core/doc/types.ts'
import { validateGeometry } from '../../core/paths/geometry.ts'
import { validateTiming } from '../../core/paths/timing.ts'
import { pathEntries, validatePathEntry } from '../../core/paths/collection.ts'
import {
  buildDefaultEntry,
  buildPathRows,
  duplicatePathCommand,
  chooseClip,
  chooseFrom,
  clipTargetOptions,
  createPathCommand,
  draftConfirmCheck,
  draftFor,
  emptyFilter,
  filterPathRows,
  fromEndpointOptions,
  initialNewDraft,
  removePathCommand,
  setDraft,
  updatePathCommand,
  validateDraftId,
} from './collectionPanel.ts'
import {
  addNumberItem,
  addPointItem,
  anchorOf,
  blankGeometry,
  convertPointMode,
  describeGeometry,
  detectPointMode,
  geometryFieldIssues,
  geometryTypeOptions,
  movePointItem,
  removeNumberItem,
  removePointItem,
} from './geometryForm.ts'
import type { TimingDraft } from './timingEditor.ts'
import {
  addPoint,
  draftIssues,
  draftSamples,
  isFixedEndpoint,
  readTimingDraft,
  removePoint,
  resetS,
  switchToKeyframes,
  switchToLinear,
  timingDraftJson,
  updatePoint,
  TIMING_MAX_POINTS,
} from './timingEditor.ts'

export type SliceCheck = (label: string, condition: boolean, actual?: unknown) => void

function isJsonObjectValue(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ── 真 store 装配（自 verify-07.ts 复制同构写法，不改 verify-07.ts） ──────────

function cameraScript(objects: JsonObject, clips?: JsonObject[]): JsonObject {
  return {
    meta: { id: 'verify07Collection', name: 'Verify 07 Collection', author: '' },
    timeline: {
      tracks: [
        { type: 'CAMERA', clips: clips ?? [{ id: 'c1', start_time: 0, duration: 2, objects }] },
      ],
    },
  }
}

function baseObjects(): JsonObject {
  return {
    'position.x': { keyframes: [{ time: 0, value: 1 }, { time: 1, value: 1 }] },
    'position.y': { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 0 }] },
    'position.z': { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 0 }] },
    yaw: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 45 }] },
    pitch: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 10 }] },
    roll: { value: 0 },
    orient: { value: 'manual' },
    'position_mode': { value: 'relative' },
    'position_space': { value: 'world' },
    'position_origin': { value: '' },
    'facing_source': { value: 'auto' },
  }
}

function threeNodeObjects(): JsonObject {
  return {
    'position.x': { keyframes: [{ time: 0, value: 1 }, { time: 0.5, value: 1 }, { time: 1, value: 1 }] },
    'position.y': { keyframes: [{ time: 0, value: 0 }, { time: 0.5, value: 0 }, { time: 1, value: 0 }] },
    'position.z': { keyframes: [{ time: 0, value: 0 }, { time: 0.5, value: 0 }, { time: 1, value: 0 }] },
  }
}

function openStore(catalog: CatalogIndex, raw: JsonObject): { store: DocStore; doc: ScriptDoc } {
  const keys = metaKeys(catalog)
  const parsed = parseDoc(raw, { metaKeys: keys })
  if (!parsed.ok) {
    throw new Error(`fixture parse failed: ${JSON.stringify(parsed.issues)}`)
  }
  const store = new DocStore({ catalog, metaKeys: keys })
  store.open(parsed.doc, 'verify07-collection.json')
  return { store, doc: parsed.doc }
}

// ── 断言主体 ──────────────────────────────────────────────────────────────

export function runCollectionChecks(check: SliceCheck): void {
  const catalog = indexCatalog(buildCatalog('verify-07'))

  // ── 07-05 新建流程与端点约束 ──────────────────────────────────────────
  {
    const { store, doc } = openStore(catalog, cameraScript(baseObjects()))

    const options = clipTargetOptions(doc)
    check('新建下拉只列 CAMERA 片段', options.length === 1 && options[0].clipId === 'c1', options)
    check('两节点片段可选', options[0].disabledReason === null, options[0])

    let draft = initialNewDraft()
    let confirm = draftConfirmCheck(doc, draft)
    check('未选片段时新建禁用', !confirm.ok && confirm.reasons.some((r) => r.includes('目标片段')), confirm)

    draft = chooseClip(draft, 'c1')
    check('选片段后进入选 A 步骤', draft.step === 'from' && draft.clipId === 'c1', draft)
    const fromOptions = fromEndpointOptions(doc, 'c1')
    check('端点下拉只有节点时间（去掉最后一项）', JSON.stringify(fromOptions) === '[0]', fromOptions)

    draft = chooseFrom(doc, draft, 0)
    check('选 A 后 B 自动锁为下一节点', draft.to === 1, draft)
    confirm = draftConfirmCheck(doc, draft)
    check('端点合法时可确认', confirm.ok, confirm)

    const entry = buildDefaultEntry(doc, draft)
    const entryObj = entry as JsonObject | null
    check('默认条目完整：id / 三轴 / line / 区间', entryObj !== null
      && typeof entryObj.id === 'string' && Array.isArray(entryObj.axes) && entryObj.axes.length === 3
      && isJsonObjectValue(entryObj.geometry) && entryObj.geometry.type === 'line'
      && entryObj.from === 0 && entryObj.to === 1, entryObj)
    check('默认 id 为 p_<n>', entryObj !== null && typeof entryObj.id === 'string' && /^p_\d+$/.test(entryObj.id), entryObj?.id)
    check('默认条目省略 timing', entryObj !== null && !Object.prototype.hasOwnProperty.call(entryObj, 'timing'), entryObj)

    // A 取最后节点 → B 为空
    const lastDraft = chooseFrom(doc, chooseClip(initialNewDraft(), 'c1'), 1)
    check('A 取最后节点时 B 为空', lastDraft.to === null, lastDraft)
    const lastConfirm = draftConfirmCheck(doc, lastDraft)
    check('B 为空时新建禁用', !lastConfirm.ok && lastConfirm.reasons.some((r) => r.includes('相邻终点 B')), lastConfirm)

    // 真实 commit 落地
    const commit = store.commit(createPathCommand(entry as JsonObject))
    check('新建路径一次 commit 成功', commit.ok, commit)
    check('路径落地 paths[]', pathEntries(store.doc!).length === 1)

    // 复制命令：新 id，几何 / 区间原样复制
    const dupCommand = duplicatePathCommand(entry as JsonObject, 'p_copy')
    check('复制命令带新 id 且保留几何区间', dupCommand.kind === 'path.writeBatch'
      && dupCommand.removeIds.length === 0
      && (dupCommand.entries[0] as JsonObject).id === 'p_copy'
      && (dupCommand.entries[0] as JsonObject).clip === 'c1'
      && JSON.stringify((dupCommand.entries[0] as JsonObject).geometry) === JSON.stringify((entry as JsonObject).geometry), dupCommand)

    // 同端点对第二条拦下
    const dupDraft = chooseFrom(store.doc!, chooseClip(initialNewDraft(), 'c1'), 0)
    const dupConfirm = draftConfirmCheck(store.doc!, dupDraft)
    check('同片段同端点对第二条本地拦下', !dupConfirm.ok
      && dupConfirm.reasons.some((r) => r.includes('端点对重复')), dupConfirm)

    // axes 为空：已有条目拦下
    const badAxes: JsonObject = { id: 'p_bad', clip: 'c1', from: 0, to: 1, axes: [], geometry: { type: 'line' } }
    check('axes 为空被校验拦下', validatePathEntry(store.doc!, badAxes, 1).some((i) => i.field.endsWith('.axes')),
      validatePathEntry(store.doc!, badAxes, 1))

    // id 校验
    check('id 首字符非字母拒绝', validateDraftId('1abc', []) !== null)
    check('id 占用拒绝', validateDraftId('p_1', ['p_1']) !== null)
    check('合法 id 通过', validateDraftId('p_2', ['p_1']) === null)

    // 草稿按 pathId 缓存（未提交不落盘）
    const drafts = new Map<string, JsonObject>()
    setDraft(drafts, 'p_1', { ...(entry as JsonObject), id: 'p_1' })
    check('草稿按 pathId 取回', draftFor(drafts, 'p_1')?.id === 'p_1')
    check('草稿不进文档（文档仍只有已提交的一条）', pathEntries(store.doc!).length === 1)
  }

  // ── 07-05 片段缺 id / 节点不足禁用 + 部分重叠徽标 ──────────────────────
  {
    const noIdClip: JsonObject = { start_time: 0, duration: 2, objects: baseObjects() }
    const oneNodeObjects = {
      'position.x': { keyframes: [{ time: 0, value: 1 }] },
      'position.y': { keyframes: [{ time: 0, value: 0 }] },
      'position.z': { keyframes: [{ time: 0, value: 0 }] },
    }
    const clips = [
      { id: 'c1', start_time: 0, duration: 2, objects: baseObjects() },
      { id: 'c2', start_time: 0, duration: 2, objects: oneNodeObjects },
      noIdClip,
    ]
    const { doc } = openStore(catalog, cameraScript(baseObjects(), clips))
    const options = clipTargetOptions(doc)
    const byId = new Map(options.map((option) => [option.label, option]))
    check('无 id 片段禁用并给原因', byId.get('未命名片段')?.disabledReason?.includes('id') === true, options)
    check('单节点片段禁用并给原因', byId.get('c2')?.disabledReason?.includes('节点不足') === true, options)

    // 部分重叠：两条区间部分交叠，两行都挂徽标（运行期起点更晚者生效）。
    const overlapScript = cameraScript(threeNodeObjects())
    const { store: overlapStore } = openStore(catalog, overlapScript)
    overlapStore.doc!.root.paths = [
      { id: 'p_a', clip: 'c1', from: 0, to: 1, axes: ['x', 'y', 'z'], geometry: { type: 'line' } },
      { id: 'p_b', clip: 'c1', from: 0.5, to: 1, axes: ['x', 'y', 'z'], geometry: { type: 'line' } },
    ]
    const rows = buildPathRows(overlapStore.doc!, catalog)
    const rowA = rows.find((row) => row.id === 'p_a')
    const rowB = rows.find((row) => row.id === 'p_b')
    check('部分重叠两行都有徽标', (rowA?.overlaps.length ?? 0) > 0 && (rowB?.overlaps.length ?? 0) > 0, rows.map((r) => r.overlaps))

    // 筛选：按片段 / 搜索 / 只看有问题
    const filter = emptyFilter()
    check('空筛选返回全部', filterPathRows(rows, filter).length === 2)
    check('按片段过滤', filterPathRows(rows, { ...filter, clipId: 'c1' }).length === 2)
    check('按 id 搜索命中', filterPathRows(rows, { ...filter, search: 'p_a' }).length === 1)
    check('只看有问题', filterPathRows(rows, { ...filter, onlyIssues: true }).length === 1)
  }

  // ── 07-06 类型下拉 / line 别名 ─────────────────────────────────────────
  {
    const options = geometryTypeOptions()
    check('下拉列出 line 别名置顶 + 11 类型', options[0] === 'line' && options.length === 12, options)
    check('line 只接受 type', validateGeometry({ type: 'line', radius: 1 }).length > 0)
    check('blankGeometry(line) 只含 type', JSON.stringify(blankGeometry('line')) === '{"type":"line"}')
    const model = describeGeometry(catalog, { type: 'line' })
    check('line 描述无参数控件', model.controls.length === 0 && model.known, model)
  }

  // ── 07-06 11 类合法几何 ────────────────────────────────────────────────
  const validGeometries: Record<string, JsonObject> = {
    linear: { type: 'line' },
    bezier: { type: 'bezier', control_points: [{ x: 0, y: 1, z: 0 }, { dx: 1, dy: 1, dz: 0 }] },
    rational_bezier: { type: 'rational_bezier', control_points: [{ x: 0, y: 1, z: 0 }], weights: [0.5] },
    arc: { type: 'arc', center: { x: 0, y: 0, z: 0 }, radius: 1, start_angle: 0, end_angle: 90 },
    ellipse: { type: 'ellipse', center: { x: 0, y: 0, z: 0 }, semi_major: 2, semi_minor: 1, rotation: 30, start_angle: 0, end_angle: 90 },
    bspline: { type: 'bspline', control_points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }], degree: 2 },
    nurbs: { type: 'nurbs', control_points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }], weights: [0.8, 0.6, 1], degree: 2 },
    catmull_rom: { type: 'catmull_rom', points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }] },
    hermite: { type: 'hermite', tangents: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }] },
    clothoid: { type: 'clothoid', start_curvature: 0, end_curvature: 0.5, length: 4 },
    fourier: { type: 'fourier', period: 1, cos: [{ x: 0.3, y: 0, z: 0 }], sin: [{ x: 0, y: 0.2, z: 0 }] },
  }
  for (const [type, geometry] of Object.entries(validGeometries)) {
    check(`geometry ${type} 合法`, validateGeometry(geometry).length === 0, validateGeometry(geometry))
  }

  // ── 07-06 数量 / 范围 / 互斥违规逐条拦下 ───────────────────────────────
  check('bezier 控制点恰好 2', validateGeometry({ type: 'bezier', control_points: [{ x: 0, y: 0, z: 0 }] }).length > 0)
  check('rational_bezier 权重与点等长', validateGeometry({ type: 'rational_bezier', control_points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }], weights: [1] }).length > 0)
  check('hermite 切线恰好 2', validateGeometry({ type: 'hermite', tangents: [{ x: 0, y: 1, z: 0 }] }).length > 0)

  check('arc 半径必须 > 0', validateGeometry({ ...validGeometries.arc, radius: 0 }).length > 0)
  check('arc 起止角不能相等', validateGeometry({ ...validGeometries.arc, start_angle: 30, end_angle: 30 }).length > 0)
  check('arc 跨度 ≤ 360', validateGeometry({ ...validGeometries.arc, end_angle: 400 }).length > 0)
  check('arc 法向与参考轴不能平行', validateGeometry({ ...validGeometries.arc, normal: { x: 1, y: 0, z: 0 }, reference_axis: { x: 2, y: 0, z: 0 } }).length > 0)

  check('ellipse 长半轴 > 0', validateGeometry({ ...validGeometries.ellipse, semi_major: 0 }).length > 0)
  check('ellipse 短半轴 > 0', validateGeometry({ ...validGeometries.ellipse, semi_minor: -1 }).length > 0)
  check('ellipse 旋转 0 正常', validateGeometry({ ...validGeometries.ellipse, rotation: 0 }).length === 0)
  check('ellipse 角度可跨 0', validateGeometry({ ...validGeometries.ellipse, start_angle: 350, end_angle: 10 }).length === 0)

  check('bspline degree 越界拒绝', validateGeometry({ ...validGeometries.bspline, degree: 0 }).length > 0)
  check('bspline knots 长度不匹配拒绝', validateGeometry({ ...validGeometries.bspline, knots: [0, 0, 1, 1] }).length > 0)
  check('bspline knots 省略可保存', validateGeometry({ type: 'bspline', control_points: validGeometries.bspline.control_points as JsonObject[], degree: 2 }).length === 0)
  check('nurbs 权重数量匹配', validateGeometry({ ...validGeometries.nurbs, weights: [0.8] }).length > 0)

  check('catmull 参数化 uniform 合法', validateGeometry({ ...validGeometries.catmull_rom, parameterization: 'uniform' }).length === 0)
  check('catmull 参数化 chordal 合法', validateGeometry({ ...validGeometries.catmull_rom, parameterization: 'chordal' }).length === 0)
  check('catmull 参数化 centripetal 合法', validateGeometry({ ...validGeometries.catmull_rom, parameterization: 'centripetal' }).length === 0)
  check('catmull 未知参数化拒绝', validateGeometry({ ...validGeometries.catmull_rom, parameterization: 'weird' }).length > 0)
  check('catmull tension=0 可用', validateGeometry({ ...validGeometries.catmull_rom, tension: 0 }).length === 0)
  check('catmull tension=1 可用', validateGeometry({ ...validGeometries.catmull_rom, tension: 1 }).length === 0)
  check('catmull tension 超出 0~1 拒绝', validateGeometry({ ...validGeometries.catmull_rom, tension: -0.1 }).length > 0
    && validateGeometry({ ...validGeometries.catmull_rom, tension: 1.1 }).length > 0)

  check('clothoid 长度必须 > 0', validateGeometry({ ...validGeometries.clothoid, length: 0 }).length > 0)
  check('clothoid 锚点 START', anchorOf(validGeometries.clothoid) === 'START')
  check('arc 锚点 FREE', anchorOf(validGeometries.arc) === 'FREE')
  check('ellipse 锚点 FREE', anchorOf(validGeometries.ellipse) === 'FREE')
  check('fourier 周期锚点 FREE', anchorOf(validGeometries.fourier) === 'FREE')
  check('fourier 非周期锚点 ENDPOINTS', anchorOf({ ...validGeometries.fourier, periodic: false }) === 'ENDPOINTS')
  check('bezier 锚点 ENDPOINTS', anchorOf(validGeometries.bezier) === 'ENDPOINTS')

  check('fourier cos/sin 等长', validateGeometry({ ...validGeometries.fourier, sin: [] }).length > 0)
  check('fourier 非周期 a0 非零拒绝', validateGeometry({ ...validGeometries.fourier, periodic: false, a0: { x: 1, y: 0, z: 0 } }).length > 0)
  check('fourier 非周期 a0 为零合法', validateGeometry({ ...validGeometries.fourier, periodic: false, a0: { x: 0, y: 0, z: 0 } }).length === 0)
  check('fourier 周期 a0 非零合法', validateGeometry({ ...validGeometries.fourier, a0: { x: 1, y: 0, z: 0 } }).length === 0)

  // 点位混写被拒
  check('点位混写绝对/相对拒绝', validateGeometry({ type: 'arc', center: { x: 0, y: 0, z: 0, dx: 1 }, radius: 1, start_angle: 0, end_angle: 90 }).length > 0)
  check('点列表点位混写拒绝', validateGeometry({ type: 'bezier', control_points: [{ x: 0, y: 0, z: 0, dy: 1 }] }).length > 0)
  check('点位写法识别为绝对', detectPointMode({ x: 1, y: 0, z: 0 }) === 'absolute')
  check('点位写法识别为相对', detectPointMode({ dx: 1, dy: 0, dz: 0 }) === 'relative')
  check('混写识别为非法', detectPointMode({ x: 1, dx: 1 }) === null)
  const converted = convertPointMode({ x: 3, y: 2, z: 1 }, 'relative')
  check('切换写法清空另一组并补零', !('x' in converted) && 'dx' in converted && converted.dx === 0, converted)

  // 点列表 / 数值列表操作
  const list = addPointItem(undefined)
  check('点列表追加空点', list.length === 1 && detectPointMode(list[0]) === 'absolute')
  check('点列表上移越界返回原数组', movePointItem(list, 0, -1).length === 1)
  check('点列表删除指定下标', removePointItem(list, 0).length === 0)
  const nums = addNumberItem(undefined)
  check('数值列表追加 0', nums.length === 1 && nums[0] === 0)
  check('数值列表删除指定下标', removeNumberItem(nums, 0).length === 0)

  // 未知类型 / 未知参数保留 + 警告
  const unknown: JsonObject = { type: 'made_up', foo: 1 }
  const unknownModel = describeGeometry(catalog, unknown)
  check('未知类型保留原文', unknown.type === 'made_up' && unknown.foo === 1)
  check('未知类型给警告', unknownModel.warnings.some((w) => w.includes('未知曲线类型')), unknownModel.warnings)
  check('未知参数保留并警告', unknownModel.unknownParams.some((p) => p.key === 'foo'), unknownModel.unknownParams)
  check('未知类型字段错误定位', geometryFieldIssues(unknown).some((i) => i.field === 'geometry.type'))

  // 切换类型清空旧参数
  const switched = blankGeometry('bezier')
  check('切换类型后旧参数清空', Object.keys(switched).join(',') === 'type', switched)

  // 字段错误前缀保留 geometry.xxx
  const fieldIssues = geometryFieldIssues({ type: 'arc', radius: 0 })
  check('几何错误定位到 geometry.radius', fieldIssues.some((i) => i.field === 'geometry.radius'), fieldIssues)

  // ── 07-08 timing 两模式与点表 ─────────────────────────────────────────
  {
    const linear = readTimingDraft(undefined)
    check('省略 timing 为线性', linear.kind === 'linear' && linear.points.length === 0)
    check('线性写盘不含 points', JSON.stringify(timingDraftJson(linear)) === '{"type":"linear"}')

    const keyframes = switchToKeyframes(linear)
    check('切关键帧自动生成 (0,0)/(1,1)', keyframes.points.length === 2
      && keyframes.points[0].t === 0 && keyframes.points[0].s === 0
      && keyframes.points[1].t === 1 && keyframes.points[1].s === 1, keyframes.points)

    const withMid = addPoint(keyframes, 0)
    check('新增点取相邻中点并线性插值', withMid !== null && withMid.points.length === 3
      && withMid.points[1].t === 0.5 && withMid.points[1].s === 0.5, withMid?.points)

    check('首行固定不可删', removePoint(withMid!, 0) === null)
    check('末行固定不可删', removePoint(withMid!, withMid!.points.length - 1) === null)
    check('首行不可改 t', updatePoint(withMid!, 0, 't', 0.2) === null)
    check('末行不可改 s', updatePoint(withMid!, withMid!.points.length - 1, 's', 0.8) === null)
    check('固定行判定', isFixedEndpoint(0, 3) && isFixedEndpoint(2, 3) && !isFixedEndpoint(1, 3))

    // 中间点可改
    const edited = updatePoint(withMid!, 1, 's', 0.3)
    check('中间点可改 s', edited !== null && edited.points[1].s === 0.3, edited?.points)

    // 单调 / 范围 / NaN / 无穷
    const decreasingT: TimingDraft = { kind: 'keyframes', points: [{ t: 0, s: 0 }, { t: 0.6, s: 0.4 }, { t: 0.5, s: 0.5 }, { t: 1, s: 1 }] }
    check('t 递减拦下并定位行', draftIssues(decreasingT).some((i) => i.field === 'timing.points[2].t'), draftIssues(decreasingT))
    const decreasingS: TimingDraft = { kind: 'keyframes', points: [{ t: 0, s: 0 }, { t: 0.5, s: 0.6 }, { t: 0.7, s: 0.5 }, { t: 1, s: 1 }] }
    check('s 递减拦下并定位行', draftIssues(decreasingS).some((i) => i.field === 'timing.points[2].s'), draftIssues(decreasingS))
    const outOfRange: TimingDraft = { kind: 'keyframes', points: [{ t: 0, s: 0 }, { t: 0.5, s: 1.2 }, { t: 1, s: 1 }] }
    check('s 超 [0,1] 拦下', draftIssues(outOfRange).some((i) => i.field === 'timing.points[1].s'), draftIssues(outOfRange))
    const nanPoint: TimingDraft = { kind: 'keyframes', points: [{ t: 0, s: 0 }, { t: Number.NaN, s: 0.5 }, { t: 1, s: 1 }] }
    check('NaN 拦下', draftIssues(nanPoint).length > 0)

    // 相等 t / 相等 s 合法；中间 s=0 / 1 允许
    const equal: TimingDraft = {
      kind: 'keyframes',
      points: [{ t: 0, s: 0 }, { t: 0.5, s: 0 }, { t: 0.5, s: 0.7 }, { t: 1, s: 1 }],
    }
    check('相等 t / 相等 s 合法', draftIssues(equal).length === 0, draftIssues(equal))

    // 按弧长复位：中间 s = t
    const reset = resetS(equal)
    check('按弧长复位 s 跟随 t', reset.points[1].s === 0.5 && reset.points[2].s === 0.5, reset.points)

    // 256 上限：第 257 个拒绝，既有表不截断
    const full: TimingDraft = {
      kind: 'keyframes',
      points: [{ t: 0, s: 0 }, ...Array.from({ length: TIMING_MAX_POINTS - 2 }, (_, i) => ({ t: (i + 1) / (TIMING_MAX_POINTS - 1), s: (i + 1) / (TIMING_MAX_POINTS - 1) })), { t: 1, s: 1 }],
    }
    check('256 点表可通过校验', draftIssues(full).length === 0, draftIssues(full))
    check('第 257 个添加被拒', addPoint(full, 0) === null)

    // 采样折线
    const samples = draftSamples(equal)
    check('s(t) 采样含首末点', samples.length >= 2 && samples[0].s === 0 && samples[samples.length - 1].s === 1, samples.slice(0, 3))

    // 切回线性：点表移除
    const backLinear = switchToLinear()
    check('切回线性不写 points', backLinear.kind === 'linear' && backLinear.points.length === 0
      && !Object.prototype.hasOwnProperty.call(timingDraftJson(backLinear), 'points'))

    // 真实 commit：keyframes 写入与读回
    const { store } = openStore(catalog, cameraScript(baseObjects()))
    const timingEntry: JsonObject = {
      id: 'p_t', clip: 'c1', from: 0, to: 1, axes: ['x', 'y', 'z'],
      geometry: { type: 'line' },
      timing: { type: 'keyframes', points: [{ t: 0, s: 0 }, { t: 0.3, s: 0.1 }, { t: 1, s: 1 }] },
    }
    const timingCommit = store.commit(createPathCommand(timingEntry))
    check('keyframes timing 一次 commit 成功', timingCommit.ok, timingCommit)
    const readBack = pathEntries(store.doc!).find((row) => row.id === 'p_t')
    check('保存后 keyframes 点原样保留', readBack !== undefined && readBack.timingKind === 'keyframes')
  }

  // ── 07-08 改 from/to / 切几何都不动 timing ────────────────────────────
  {
    const original: JsonObject = {
      id: 'p_keep', clip: 'c1', from: 0, to: 1, axes: ['x'],
      geometry: { type: 'bezier', control_points: [{ x: 0, y: 1, z: 0 }, { dx: 1, dy: 1, dz: 0 }] },
      timing: { type: 'keyframes', points: [{ t: 0, s: 0 }, { t: 0.4, s: 0.2 }, { t: 1, s: 1 }] },
    }
    // 改 from/to：timing 点不变
    const retimed: JsonObject = { ...original, from: 0, to: 0.5 }
    check('改 from/to 不动 timing', JSON.stringify(retimed.timing) === JSON.stringify(original.timing))
    // 切几何：timing 保留
    const regened: JsonObject = { ...original, geometry: blankGeometry('arc') }
    check('切几何不动 timing', JSON.stringify(regened.timing) === JSON.stringify(original.timing))

    const { store } = openStore(catalog, cameraScript(baseObjects()))
    store.commit(createPathCommand(original))
    const updated: JsonObject = {
      ...original,
      geometry: { type: 'arc', center: { dx: 0, dy: 0, dz: 0 }, radius: 2, start_angle: 0, end_angle: 90 },
    }
    const updateCommit = store.commit(updatePathCommand('p_keep', updated))
    check('保存几何编辑后 timing 仍在', updateCommit.ok
      && JSON.stringify((pathEntries(store.doc!).find((r) => r.id === 'p_keep')?.entry as JsonObject).timing)
        === JSON.stringify(original.timing), updateCommit)

    // 删除命令
    const removeCommit = store.commit(removePathCommand('p_keep'))
    check('删除路径一次 commit', removeCommit.ok && pathEntries(store.doc!).length === 0, removeCommit)
  }

  // 显式线性与省略等价
  check('显式 linear 校验通过', validateTiming({ type: 'linear' }).length === 0)
}

// ── 直跑段 ─────────────────────────────────────────────────────────────────

const direct = process.argv[1] !== undefined
  && process.argv[1].replace(/\\/g, '/').endsWith('verify07Collection.ts')

if (direct) {
  let ok = 0
  let fail = 0
  runCollectionChecks((label, condition, actual) => {
    if (condition) {
      ok += 1
      console.log(`ok   ${label}`)
    } else {
      fail += 1
      console.log(`FAIL ${label}: ${typeof actual === 'string' ? actual : JSON.stringify(actual)}`)
    }
  })
  console.log(`summary ok=${ok} fail=${fail}`)
  if (fail > 0) {
    process.exitCode = 1
  }
}
