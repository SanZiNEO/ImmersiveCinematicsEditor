/**
 * 12-09 几何工具自检（`runGeometryTools(check, ctx)`）。
 *
 * 覆盖契约 §3 与 plan 12-09 §4 / §5 的几何口径：
 * - 统一系数取两比例较小者（宽紧 / 高紧两组）；
 * - 基准=播放、scale=1 时裁切一半的基准 / 最终尺寸数值正确；
 * - 改基准分辨率只变覆盖层示意，相机矩形数值不变；
 * - 目标比例与素材不一致只提示、不改源裁切；
 * - 相机矩形不出现「像素 × 系数」结果，不与覆盖层混算；
 * - 缩放 0 / 负提示且值不变；裁切 0 / 负拒绝；超窗允许写入且只提示；
 * - 素材尺寸未知如实提示；Gizmo 一次提交一次撤销、无旋转项；
 * - 基准分辨率写文档的命令字段名与目录一致。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { JsonObject } from '../../core/doc/types.ts'
import { DocStore } from '../../core/doc/store.ts'
import {
  BASE_RESOLUTION_KEY,
  GIZMO_HANDLES,
  GIZMO_ROTATION_HANDLES,
  baseResolutionCommands,
  boundingBox,
  cameraRectToNormalized,
  gizmoCommands,
  overlayChain,
  overlayScaleFactor,
  planGizmoDrag,
  readCameraComposite,
  readGizmoGeometry,
  regionPlan,
  resolveBaseResolution,
  validateBaseResolutionInput,
} from '../../features/geometry/index.ts'
import type { CropRect, GizmoGeometry } from '../../features/geometry/index.ts'
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'

const EPS = 1e-6

function approx(actual: number, expected: number, eps = EPS): boolean {
  return Math.abs(actual - expected) <= eps
}

function numOf(objects: JsonObject, path: string, fallback: number): number {
  const raw = objects[path]
  if (raw === null || typeof raw !== 'object') return fallback
  const value = (raw as { value?: unknown }).value
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function overlayRoot(): JsonObject {
  return {
    meta: { id: 'g12-09', name: 'geometry', author: 'verify' },
    timeline: {
      tracks: [
        {
          type: 'OVERLAY',
          clips: [{
            id: 'ov1',
            start_time: 0,
            duration: 2,
            objects: {
              layer_type: { value: 'image' },
              x: { value: 0.5 },
              y: { value: 0.5 },
              anchor_x: { value: 0.5 },
              anchor_y: { value: 0.5 },
              scale_x: { value: 1 },
              scale_y: { value: 1 },
              'source.x': { value: 0 },
              'source.y': { value: 0 },
              'source.w': { value: 0.5 },
              'source.h': { value: 0.5 },
            },
          }],
        },
        {
          type: 'CAMERA',
          clips: [{
            id: 'cam1',
            start_time: 0,
            duration: 2,
            objects: {
              'dest.x': { value: 0.1 },
              'dest.y': { value: 0.2 },
              'dest.w': { value: 0.3 },
              'dest.h': { value: 0.4 },
              'source.x': { value: 0 },
              'source.y': { value: 0 },
              'source.w': { value: 1 },
              'source.h': { value: 1 },
            },
          }],
        },
      ],
    },
  }
}

function openStore(ctx: VerifyContext, root: JsonObject): DocStore {
  const store = ctx.createStore()
  store.open(ctx.docFrom(root), 'verify-12-09.json')
  return store
}

function clipObjects(store: DocStore, clipId: string): { clipKey: string; objects: JsonObject } {
  const handle = store.registry.handles().find((entry) => entry.id === clipId)
  if (handle === undefined) {
    throw new Error(`夹具片段不存在: ${clipId}`)
  }
  const objects = handle.clip.objects
  return { clipKey: handle.key, objects: objects as JsonObject }
}

function overlayInput(overrides: Partial<Parameters<typeof overlayChain>[0]>): Parameters<typeof overlayChain>[0] {
  return {
    playW: 1920,
    playH: 1080,
    baseW: 1920,
    baseH: 1080,
    sourceWidth: 1000,
    sourceHeight: 500,
    crop: { x: 0, y: 0, w: 0.5, h: 0.5 },
    scaleX: 1,
    scaleY: 1,
    x: 0.5,
    y: 0.5,
    anchorX: 0.5,
    anchorY: 0.5,
    ...overrides,
  }
}

export function runGeometryTools(check: CheckFn, ctx: VerifyContext): void {
  // ── G1 统一系数：两比例较小者（宽紧 / 高紧两组）────────────────────────────
  check('系数：基准=播放时 k=1', approx(overlayScaleFactor({ playW: 1920, playH: 1080, baseW: 1920, baseH: 1080 }), 1))

  // 宽紧：1280/1920=0.6667 < 960/1080=0.8889。
  const widthTight = overlayScaleFactor({ playW: 1280, playH: 960, baseW: 1920, baseH: 1080 })
  check('系数：宽紧时取宽度比例 2/3', approx(widthTight, 1280 / 1920), widthTight)

  // 高紧：1600/1920=0.8333 > 800/1080=0.7407。
  const heightTight = overlayScaleFactor({ playW: 1600, playH: 800, baseW: 1920, baseH: 1080 })
  check('系数：高紧时取高度比例 800/1080', approx(heightTight, 800 / 1080), heightTight)

  // ── G2 裁切一半：基准=播放、scale=1 时尺寸链数值正确 ──────────────────────
  const chain = overlayChain(overlayInput({}))
  check('链路：素材已知', chain.sourceKnown === true, chain.sourceKnown)
  check('链路：裁切后像素 500×250',
    chain.cropped.width !== null && approx(chain.cropped.width, 500) &&
    chain.cropped.height !== null && approx(chain.cropped.height, 250), chain.cropped)
  check('链路：基准尺寸 500×250（k=1）',
    chain.baseSize.width !== null && approx(chain.baseSize.width, 500) &&
    chain.baseSize.height !== null && approx(chain.baseSize.height, 250), chain.baseSize)
  check('链路：最终显示 500×250（scale=1）',
    chain.finalSize.width !== null && approx(chain.finalSize.width, 500) &&
    chain.finalSize.height !== null && approx(chain.finalSize.height, 250), chain.finalSize)

  // ── G3 基准分辨率隔离：相机矩形数值不随基准分辨率变 ──────────────────────
  const storeA = openStore(ctx, overlayRoot())
  const camA = clipObjects(storeA, 'cam1')
  const camModelA = cameraRectToNormalized(readCameraComposite(camA.objects))
  const baseA = resolveBaseResolution(storeA.doc)
  check('基准分辨率：显式 1280×720 解析', baseA.explicit === false, baseA)

  const rootB = overlayRoot()
  const metaB = rootB.meta as JsonObject
  metaB.base_resolution = { w: 1280, h: 720 }
  const storeB = openStore(ctx, rootB)
  const camB = clipObjects(storeB, 'cam1')
  const camModelB = cameraRectToNormalized(readCameraComposite(camB.objects))
  const baseB = resolveBaseResolution(storeB.doc)
  check('基准分辨率：显式 1280×720 被读出', baseB.explicit === true && baseB.width === 1280 && baseB.height === 720, baseB)

  check('隔离：相机 dest 不随基准分辨率变',
    approx(camModelA.dest.x, camModelB.dest.x) && approx(camModelA.dest.w, camModelB.dest.w) &&
    approx(camModelA.dest.h, camModelB.dest.h), [camModelA.dest, camModelB.dest])
  check('隔离：相机 source 不随基准分辨率变',
    approx(camModelA.source.w, camModelB.source.w) && approx(camModelA.source.h, camModelB.source.h),
    [camModelA.source, camModelB.source])

  // ── G4 比例不一致：只提示，不改源裁切 ─────────────────────────────────────
  const mismatchPlan = regionPlan({
    target: { x: 0, y: 0, width: 0.5, height: 0.25 },
    sourceAspect: 1,
    croppedPixels: { width: 100, height: 100 },
    factor: 1,
    playW: 1920,
    playH: 1080,
    anchorX: 0.5,
    anchorY: 0.5,
  })
  check('规划：目标 2:1 与素材 1:1 判为比例不一致', mismatchPlan.aspectMismatch === true, mismatchPlan.aspectMismatch)
  check('规划：比例不一致只给提示不阻塞', mismatchPlan.issues.length === 0 && mismatchPlan.warnings.length > 0, mismatchPlan)

  const overflowPlan = regionPlan({
    target: { x: 0.9, y: 0.1, width: 0.3, height: 0.5 },
    sourceAspect: 1,
    croppedPixels: { width: 100, height: 100 },
    factor: 1,
    playW: 1920,
    playH: 1080,
    anchorX: 0.5,
    anchorY: 0.5,
  })
  check('规划：超窗允许写入（issues 为空）', overflowPlan.outOfWindow === true && overflowPlan.issues.length === 0, overflowPlan)
  check('规划：超窗只给提示', overflowPlan.warnings.some((warning) => warning.includes('超出窗口')), overflowPlan.warnings)

  // ── G5 相机侧不出现像素 / 系数，不与覆盖层混算 ────────────────────────────
  check('相机：结果不含像素宽高占位', camModelB.pixelWidth === null && camModelB.pixelHeight === null, camModelB)
  check('相机：结果不携带系数字段', !('factor' in camModelB) && !('baseSize' in camModelB), Object.keys(camModelB))
  check('相机：坐标系标记为 camera', camModelB.space === 'camera', camModelB.space)
  check('覆盖层：坐标系标记为 overlay', chain.space === 'overlay', chain.space)

  // ── G6 缩放 0 / 负：提示且不改值 ─────────────────────────────────────────
  const zeroInput = overlayInput({ scaleX: 0, scaleY: 1 })
  const zeroScale = overlayChain(zeroInput)
  check('缩放 0：给出运行时不绘制 / 翻转提示', zeroScale.warnings.some((warning) => warning.includes('scale_x')), zeroScale.warnings)
  check('缩放 0：纯函数不改写输入值', zeroInput.scaleX === 0 && zeroInput.scaleY === 1, zeroInput)
  const negativeInput = overlayInput({ scaleX: 1, scaleY: -2 })
  const negativeScale = overlayChain(negativeInput)
  check('缩放负：给出提示且不阻塞其它字段', negativeScale.warnings.some((warning) => warning.includes('scale_y')), negativeScale.warnings)
  check('缩放负：纯函数不改写输入值', negativeInput.scaleX === 1 && negativeInput.scaleY === -2, negativeInput)

  // ── G7 裁切 0 / 负：拒绝 ─────────────────────────────────────────────────
  const zeroCrop = overlayChain(overlayInput({ crop: { x: 0, y: 0, w: 0, h: 0.5 } }))
  check('裁切宽 0：阻塞拒绝', zeroCrop.issues.length > 0 && zeroCrop.cropped.width === null, zeroCrop)
  const negativeCrop = overlayChain(overlayInput({ crop: { x: 0, y: 0, w: 0.5, h: -0.2 } as CropRect }))
  check('裁切高负：阻塞拒绝', negativeCrop.issues.length > 0 && negativeCrop.cropped.height === null, negativeCrop)

  // ── G8 超窗允许写入（命令层不钳制）───────────────────────────────────────
  const storeW = openStore(ctx, overlayRoot())
  const overlayW = clipObjects(storeW, 'ov1')
  const beforeX = numOf(overlayW.objects, 'x', 0.5)
  const outCommand: DocCommand = { kind: 'object.setValue', clipKey: overlayW.clipKey, path: 'x', value: 1.2 }
  const outResult = storeW.commit(outCommand)
  check('超窗位置 1.2 允许提交', outResult.ok === true, outResult)
  const afterX = numOf(clipObjects(storeW, 'ov1').objects, 'x', beforeX)
  check('超窗值按写入落盘（不钳制到窗口内)', approx(afterX, 1.2), afterX)
  storeW.undo()
  const restoredX = numOf(clipObjects(storeW, 'ov1').objects, 'x', beforeX)
  check('超窗写入一次撤销回原值', approx(restoredX, beforeX), restoredX)

  // ── G9 素材尺寸未知：如实提示，不猜比例 ──────────────────────────────────
  const unknownSource = overlayChain(overlayInput({ sourceWidth: null, sourceHeight: null }))
  check('未知素材：sourceKnown=false', unknownSource.sourceKnown === false, unknownSource.sourceKnown)
  check('未知素材：像素链路全部留空',
    unknownSource.cropped.width === null && unknownSource.baseSize.width === null && unknownSource.finalSize.width === null,
    unknownSource)
  check('未知素材：给出不假设 16:9 / 1920×1080 的提示',
    unknownSource.warnings.some((warning) => warning.includes('未知')), unknownSource.warnings)

  // ── G10 Gizmo：一次提交一次撤销、无旋转手柄 ─────────────────────────────
  const storeG = openStore(ctx, overlayRoot())
  const overlayG = clipObjects(storeG, 'ov1')
  const beforeGeo: GizmoGeometry = readGizmoGeometry(overlayG.objects)
  const drag = planGizmoDrag({
    handle: 'move',
    geometry: beforeGeo,
    viewport: { width: 1920, height: 1080 },
    deltaX: 192,
    deltaY: 0,
  })
  check('Gizmo：移动草稿有效', drag.valid === true, drag.issues)
  check('Gizmo：移动换算为 0.1 归一化增量', approx(drag.geometry.x, beforeGeo.x + 0.1), drag.geometry)

  const gizmoCmds = gizmoCommands(overlayG.clipKey, beforeGeo, drag.geometry)
  const firstCommand = gizmoCmds[0] as { path?: string } | undefined
  check('Gizmo：移动只产出变化字段命令', gizmoCmds.length === 1 && firstCommand?.path === 'x', gizmoCmds)
  const gizmoCommit = storeG.commit({ kind: 'compound', commands: gizmoCmds })
  check('Gizmo：复合命令一次提交成功', gizmoCommit.ok === true, gizmoCommit)
  const afterGeo = readGizmoGeometry(clipObjects(storeG, 'ov1').objects)
  check('Gizmo：提交后位置落盘', approx(afterGeo.x, beforeGeo.x + 0.1), afterGeo)
  storeG.undo()
  const undoneGeo = readGizmoGeometry(clipObjects(storeG, 'ov1').objects)
  check('Gizmo：一次撤销回拖前几何', approx(undoneGeo.x, beforeGeo.x) && approx(undoneGeo.y, beforeGeo.y), undoneGeo)

  const scaleToZero = planGizmoDrag({
    handle: 'uniformScale',
    geometry: beforeGeo,
    viewport: { width: 1920, height: 1080 },
    deltaX: -1920,
    deltaY: 0,
  })
  check('Gizmo：缩放到 ≤0 草稿无效、不提交', scaleToZero.valid === false && gizmoCommands(overlayG.clipKey, beforeGeo, scaleToZero.geometry).length === 0, scaleToZero)

  check('Gizmo：手柄清单无旋转项', !(GIZMO_HANDLES as readonly string[]).includes('rotate'), [...GIZMO_HANDLES])
  check('Gizmo：旋转手柄清单恒为空', GIZMO_ROTATION_HANDLES.length === 0, [...GIZMO_ROTATION_HANDLES])

  // 多选包围盒：只显示，不产出命令。
  const box = boundingBox([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }])
  check('Gizmo：多选包围盒合并两组矩形',
    box !== null && approx(box.x, 0.1) && approx(box.y, 0.1) && approx(box.w, 0.6) && approx(box.h, 0.6), box)

  // ── G11 基准分辨率命令字段名与目录一致 ──────────────────────────────────
  check('目录：meta 键包含 base_resolution', ctx.metaKeys.includes(BASE_RESOLUTION_KEY), [...ctx.metaKeys])
  const resCommands = baseResolutionCommands({ w: 1280, h: 720 })
  check('基准分辨率：命令为 meta.set / base_resolution',
    resCommands.length === 1 && resCommands[0]?.kind === 'meta.set' && resCommands[0].key === BASE_RESOLUTION_KEY, resCommands)

  const storeR = openStore(ctx, overlayRoot())
  const resCommit = storeR.commit(resCommands[0] as DocCommand)
  check('基准分辨率：写入命令提交成功', resCommit.ok === true, resCommit)
  const metaAfter = storeR.doc?.root.meta as JsonObject | undefined
  const written = metaAfter?.[BASE_RESOLUTION_KEY] as { w: number; h: number } | undefined
  check('基准分辨率：文档落盘 {w,h}', written !== undefined && written.w === 1280 && written.h === 720, written)
  storeR.undo()
  const metaUndo = storeR.doc?.root.meta as JsonObject | undefined
  const restored = metaUndo?.[BASE_RESOLUTION_KEY]
  check('基准分辨率：撤销后声明清除', restored === null || restored === undefined, restored)

  // 校验器：非正整数拒绝，不自动改成缺省。
  const badResolution = validateBaseResolutionInput({ width: 0, height: 1080 })
  check('基准分辨率：宽 0 被拒绝', badResolution.ok === false && badResolution.value === null, badResolution)
  const nonInteger = validateBaseResolutionInput({ width: 1920.5, height: 1080 })
  check('基准分辨率：非整数被拒绝', nonInteger.ok === false, nonInteger)

  // 相机宽高比不一致只提示。
  const stretchedCamera = cameraRectToNormalized({
    dest: { x: 0, y: 0, w: 0.5, h: 0.5 },
    source: { x: 0, y: 0, w: 1, h: 1 },
  })
  check('相机：目标方形 / 源方形不判拉伸', stretchedCamera.stretched === false, stretchedCamera)
  const aspectMismatchCamera = cameraRectToNormalized({
    dest: { x: 0, y: 0, w: 0.5, h: 0.25 },
    source: { x: 0, y: 0, w: 1, h: 1 },
  })
  check('相机：目标 2:1 / 源 1:1 判拉伸且不改 source',
    aspectMismatchCamera.stretched === true && approx(aspectMismatchCamera.source.w, 1) && approx(aspectMismatchCamera.source.h, 1),
    aspectMismatchCamera)

  // 归一化矩形读取：缺省 dest/source = (0,0,1,1)。
  const defaults = readCameraComposite({})
  check('相机：空 objects 取目录缺省 (0,0,1,1)',
    approx(defaults.dest.w, 1) && approx(defaults.dest.h, 1) &&
    approx(defaults.source.w, 1) && approx(defaults.source.h, 1), defaults)
}
