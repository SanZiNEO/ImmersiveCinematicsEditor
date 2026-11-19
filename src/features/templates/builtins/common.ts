/**
 * 片段对象构造辅助（12-03/04/05 共用）。
 *
 * 只产出目录登记字段；静态值写 `{ value }`，动画写 `{ keyframes }`。value-only 字段不打关键帧。
 */
import type { JsonObject, JsonValue, ObjectKeyframe } from '../../../core/doc/types.ts'
import type { PoseValue } from '../types.ts'

/** 静态值叶子。 */
export function value(v: JsonValue): JsonObject {
  return { value: v }
}

/** 关键帧叶子。 */
export function keyframes(frames: ObjectKeyframe[]): JsonObject {
  return { keyframes: frames as unknown as JsonValue }
}

/** 一帧。 */
export function frame(time: number, v: JsonValue): ObjectKeyframe {
  return { time, value: v }
}

/** 姿态对应的静态位置 / 朝向 / 镜头对象（absolute 位置模式由调用方补）。 */
export function staticPoseObjects(pose: PoseValue): JsonObject {
  return {
    'position.x': value(pose.position.x),
    'position.y': value(pose.position.y),
    'position.z': value(pose.position.z),
    yaw: value(pose.yaw),
    pitch: value(pose.pitch),
    roll: value(pose.roll),
    fov: value(pose.fov),
    zoom: value(pose.zoom),
  }
}

/** 呼吸字段（全部 value-only 单值）；关闭时只写 enabled=false，其余呼吸字段省略。 */
export function breathObjects(input: {
  enabled: boolean
  type: string
  intensity: number
  seed: number
  speed: number
  trauma: number
  decay: number
}): JsonObject {
  const objects: JsonObject = {
    cam_breath_enabled: value(input.enabled),
  }
  if (!input.enabled) {
    return objects
  }
  objects.cam_breath_type = value(input.type)
  objects.cam_breath_intensity = value(input.intensity)
  objects.cam_breath_seed = value(input.seed)
  objects.cam_breath_speed = value(input.speed)
  if (input.type === 'trauma') {
    objects.cam_breath_trauma = value(input.trauma)
    objects.cam_breath_decay = value(input.decay)
  }
  return objects
}
