/**
 * 文档基准分辨率读 / 写 / 校验（12-09）。
 *
 * 口径（模组只读核对 `script/ScriptMeta.java` / `ScriptParser.parseBaseResolution`、
 * `overlay/CanvasTransform.java`）：
 * - 文档级对象 `meta.base_resolution = { w, h }`（像素，正整数）；
 * - 缺省 / null / 非法形状 → 按 1920×1080 处理，`explicit = false`；
 * - 基准分辨率只影响覆盖层图片 / 视频 / 字幕的缩放系数与示意；
 *   不参与相机合成矩形，也不参与字幕实际字体测量（那是运行时行为）。
 *
 * 本模块只做纯函数与命令构造：不碰 Vue、不碰 store。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import { isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import type { JsonObject, ScriptDoc } from '../../core/doc/types.ts'
import { DEFAULT_BASE_HEIGHT, DEFAULT_BASE_WIDTH } from './constants.ts'

/** 文档基准分辨率在 `meta` 下的键名（与 02 目录 `meta.base_resolution` 一致）。 */
export const BASE_RESOLUTION_KEY = 'base_resolution'

/** 解析后的基准分辨率。 */
export interface BaseResolution {
  width: number
  height: number
  /** 文档是否显式写出合法的 `{w,h}`；缺省 / 非法回退缺省值时为 `false`。 */
  explicit: boolean
}

/** 可作为 `meta` 来源的形状（`ScriptDoc.meta` 或根对象 `meta`）。 */
export type ResolutionDocSource =
  | ScriptDoc
  | { meta?: JsonObject; root?: JsonObject }
  | null
  | undefined

/** 从 `{w,h}`（或 `{value:{w,h}}`）读一对正整数；非法返回 `null`。 */
function readResolutionPair(raw: unknown): { w: number; h: number } | null {
  if (!isJsonObject(raw)) {
    return null
  }
  const inner = isJsonObject(raw.value) ? raw.value : raw
  const w = inner.w
  const h = inner.h
  if (!isFiniteNumber(w) || !isFiniteNumber(h)) {
    return null
  }
  if (!Number.isInteger(w) || !Number.isInteger(h)) {
    return null
  }
  if (w <= 0 || h <= 0) {
    return null
  }
  return { w, h }
}

/**
 * 解析文档基准分辨率；缺省 / 非法回退 1920×1080 并标 `explicit = false`。
 *
 * 不假设素材比例，也不在这里读播放窗口尺寸；系数换算见 `overlayChain.ts`。
 */
export function resolveBaseResolution(doc: ResolutionDocSource): BaseResolution {
  const meta = doc?.meta ?? (isJsonObject(doc?.root) ? doc.root.meta : undefined)
  const raw = isJsonObject(meta) ? meta[BASE_RESOLUTION_KEY] : undefined
  const pair = readResolutionPair(raw)
  if (pair === null) {
    return { width: DEFAULT_BASE_WIDTH, height: DEFAULT_BASE_HEIGHT, explicit: false }
  }
  return { width: pair.w, height: pair.h, explicit: true }
}

/** 基准分辨率编辑输入（面板表单）。 */
export interface BaseResolutionInput {
  width: number
  height: number
}

/** 校验结果。 */
export interface BaseResolutionValidation {
  ok: boolean
  issues: string[]
  /** 合法时为 `{w,h}`；拒绝时为 `null`。 */
  value: { w: number; h: number } | null
}

/**
 * 校验基准分辨率输入：单位像素、正整数。
 *
 * 非有限数 / 非整数 / ≤0 一律拒绝（与模组解析口径一致），不自动改成 1920×1080。
 */
export function validateBaseResolutionInput(input: BaseResolutionInput): BaseResolutionValidation {
  const issues: string[] = []
  const { width, height } = input
  if (!isFiniteNumber(width) || !Number.isInteger(width) || width <= 0) {
    issues.push('基准宽必须是正整数像素')
  }
  if (!isFiniteNumber(height) || !Number.isInteger(height) || height <= 0) {
    issues.push('基准高必须是正整数像素')
  }
  if (issues.length > 0) {
    return { ok: false, issues, value: null }
  }
  return { ok: true, issues, value: { w: width, h: height } }
}

/**
 * 写基准分辨率的命令（一条 `meta.set`，一个事务）。
 *
 * `value = null` 表示清除显式声明，回退缺省 1920×1080。
 */
export function baseResolutionCommands(value: { w: number; h: number } | null): DocCommand[] {
  const payload = value === null ? null : { w: value.w, h: value.h }
  return [{ kind: 'meta.set', key: BASE_RESOLUTION_KEY, value: payload }]
}
