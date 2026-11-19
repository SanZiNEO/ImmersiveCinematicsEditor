/**
 * 模板参数校验（12-01 §三 / 12-02 §三）。
 *
 * 校验只认声明：键必须在声明内、必填、默认、有限性→范围、枚举候选、颜色六位十六进制、
 * 位置三轴齐全、姿态齐全、姿态列表数量。校验期不写产物、不打关键帧。
 */
import type {
  ParamDecl,
  ParamValue,
  PoseValue,
  TemplateDefinition,
  TemplateParamIssue,
} from './types.ts'

const HEX6_PATTERN = /^#[0-9a-fA-F]{6}$/

function issue(
  paramKey: string | null,
  code: string,
  severity: TemplateParamIssue['severity'],
  message: string,
): TemplateParamIssue {
  return { paramKey, code, severity, message }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 姿态结构是否齐全：position 三轴 + yaw/pitch/roll/fov/zoom 全为有限数。 */
export function isValidPose(value: unknown): value is PoseValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const pose = value as Record<string, unknown>
  const position = pose.position
  if (position === null || typeof position !== 'object' || Array.isArray(position)) {
    return false
  }
  const p = position as Record<string, unknown>
  if (![p.x, p.y, p.z, pose.yaw, pose.pitch, pose.roll, pose.fov, pose.zoom].every(isFiniteNumber)) {
    return false
  }
  return true
}

function validatePose(param: ParamDecl, value: ParamValue): TemplateParamIssue[] {
  if (!isValidPose(value)) {
    return [issue(param.key, 'T_PARAM_POSE', 'error', `参数 ${param.key} 不是完整姿态（位置三轴与朝向角 / 镜头须齐全且为有限数）`)]
  }
  return []
}

function validateValue(param: ParamDecl, value: ParamValue): TemplateParamIssue[] {
  const issues: TemplateParamIssue[] = []
  switch (param.kind) {
    case 'number': {
      if (!isFiniteNumber(value)) {
        issues.push(issue(param.key, 'T_PARAM_TYPE', 'error', `参数 ${param.key} 必须是有限数字`))
        break
      }
      if (param.min !== undefined && value < param.min) {
        issues.push(issue(param.key, 'T_PARAM_RANGE', 'error', `参数 ${param.key} 小于下限 ${param.min}`))
      }
      if (param.max !== undefined && value > param.max) {
        issues.push(issue(param.key, 'T_PARAM_RANGE', 'error', `参数 ${param.key} 大于上限 ${param.max}`))
      }
      break
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        issues.push(issue(param.key, 'T_PARAM_TYPE', 'error', `参数 ${param.key} 必须是整数`))
        break
      }
      if (param.min !== undefined && value < param.min) {
        issues.push(issue(param.key, 'T_PARAM_RANGE', 'error', `参数 ${param.key} 小于下限 ${param.min}`))
      }
      if (param.max !== undefined && value > param.max) {
        issues.push(issue(param.key, 'T_PARAM_RANGE', 'error', `参数 ${param.key} 大于上限 ${param.max}`))
      }
      break
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        issues.push(issue(param.key, 'T_PARAM_TYPE', 'error', `参数 ${param.key} 必须是布尔值`))
      }
      break
    }
    case 'enum': {
      if (typeof value !== 'string' || !param.enumValues?.includes(value)) {
        issues.push(issue(param.key, 'T_PARAM_ENUM', 'error', `参数 ${param.key} 取值不在候选内`))
      }
      break
    }
    case 'text': {
      if (typeof value !== 'string') {
        issues.push(issue(param.key, 'T_PARAM_TYPE', 'error', `参数 ${param.key} 必须是文本`))
      }
      break
    }
    case 'selector': {
      if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push(issue(param.key, 'T_PARAM_TYPE', 'error', `参数 ${param.key} 必须是非空选择器`))
      }
      break
    }
    case 'color': {
      if (typeof value !== 'string' || !HEX6_PATTERN.test(value)) {
        issues.push(issue(param.key, 'T_PARAM_COLOR', 'error', `参数 ${param.key} 必须是六位十六进制颜色（如 #000000）`))
      }
      break
    }
    case 'pose': {
      issues.push(...validatePose(param, value))
      break
    }
    case 'poseList': {
      if (!Array.isArray(value)) {
        issues.push(issue(param.key, 'T_PARAM_TYPE', 'error', `参数 ${param.key} 必须是姿态列表`))
        break
      }
      const min = param.minCount
      const max = param.maxCount
      if (min !== undefined && value.length < min) {
        issues.push(issue(param.key, 'T_PARAM_COUNT', 'error', `参数 ${param.key} 姿态数少于 ${min}`))
      }
      if (max !== undefined && value.length > max) {
        issues.push(issue(param.key, 'T_PARAM_COUNT', 'error', `参数 ${param.key} 姿态数多于 ${max}`))
      }
      value.forEach((entry, index) => {
        if (!isValidPose(entry)) {
          issues.push(issue(param.key, 'T_PARAM_POSE', 'error', `参数 ${param.key} 第 ${index + 1} 个姿态不完整`))
        }
      })
      break
    }
    default:
      break
  }
  return issues
}

/** 取声明默认值（未给默认的必填项不在此补）。 */
export function defaultParams(def: TemplateDefinition): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {}
  for (const param of def.params) {
    out[param.key] = param.default ?? null
  }
  return out
}

/**
 * 校验入参：未声明键拒绝；必填缺省拒绝；逐 kind 校验类型 / 范围 / 枚举 / 颜色 / 姿态 / 数量。
 * 返回问题清单（不修改入参）。
 */
export function validateTemplateParams(
  def: TemplateDefinition,
  params: Record<string, ParamValue>,
): TemplateParamIssue[] {
  const issues: TemplateParamIssue[] = []
  const declared = new Map<string, ParamDecl>()
  for (const param of def.params) {
    declared.set(param.key, param)
  }
  for (const key of Object.keys(params)) {
    if (!declared.has(key)) {
      issues.push(issue(key, 'T_PARAM_UNKNOWN', 'error', `参数 ${key} 未在模板 ${def.id} 中声明`))
    }
  }
  for (const param of def.params) {
    const present = Object.prototype.hasOwnProperty.call(params, param.key)
    const raw = params[param.key]
    if (!present || raw === null) {
      if (param.required && param.default === undefined) {
        issues.push(issue(param.key, 'T_PARAM_REQUIRED', 'error', `参数 ${param.key} 为必填项`))
      }
      continue
    }
    issues.push(...validateValue(param, raw))
  }
  return issues
}

/** 用默认值补齐未提供的参数（返回新对象；模板展开期参数只读）。 */
export function resolveParams(
  def: TemplateDefinition,
  params: Record<string, ParamValue>,
): Record<string, ParamValue> {
  const resolved = defaultParams(def)
  for (const key of Object.keys(params)) {
    if (resolved[key] !== undefined || declaredKey(def, key)) {
      resolved[key] = params[key]
    }
  }
  return resolved
}

function declaredKey(def: TemplateDefinition, key: string): boolean {
  return def.params.some((param) => param.key === key)
}
