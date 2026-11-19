/**
 * 12-08 飞控姿态槽文案（ZH / EN）。
 *
 * key 前缀统一 `flight.*`；集成方在 `workbench/i18n/index.ts` 合并两张表，
 * 本插件不直接改 i18n 注册表。
 */
import type { Locale } from '../../workbench/api/context.ts'

const zhCn: Record<string, string> = {
  'flight.panel.title': '飞控姿态槽',
  'flight.panel.emptyDoc': '未打开文档：姿态槽保留会话内最近内容。',
  'flight.panel.empty': '九个槽位都为空：从飞控最近姿态、选中片段求值或手动编辑存入。',
  'flight.panel.playhead': '播放头 {time}s',

  'flight.slot.index': '槽 {index}',
  'flight.source.flight': '飞控',
  'flight.source.clip': '片段',
  'flight.source.manual': '手动',
  'flight.source.none': '空',

  'flight.field.position': '位置',
  'flight.field.yaw': '偏航',
  'flight.field.pitch': '俯仰',
  'flight.field.roll': '翻滚',
  'flight.field.fov': '视场角',
  'flight.field.zoom': '缩放',

  'flight.action.captureLatest': '存最近姿态',
  'flight.action.fromClip': '从片段取',
  'flight.action.clear': '清空',
  'flight.action.copy': '复制',
  'flight.action.paste': '粘贴',
  'flight.action.apply': '应用',
  'flight.action.edit': '编辑',

  'flight.diff.title': '应用前确认',
  'flight.diff.writes': '将写入 {count} 个字段',
  'flight.diff.old': '旧值',
  'flight.diff.new': '新值',
  'flight.diff.confirm': '确认应用',
  'flight.diff.cancel': '取消',
  'flight.diff.none': '没有可写入的字段。',

  'flight.picker.title': '选择姿态槽',
  'flight.picker.empty': '没有可用的姿态槽。',
  'flight.picker.close': '关闭',

  'flight.reason.noClip': '没有选中的相机片段。',
  'flight.reason.serviceMissing': '姿态槽服务未注册。',
}

const enUs: Record<string, string> = {
  'flight.panel.title': 'Flight Pose Slots',
  'flight.panel.emptyDoc': 'No document open: slots keep the latest in-session poses.',
  'flight.panel.empty': 'All nine slots are empty: capture from the latest flight pose, the selected clip, or manual edit.',
  'flight.panel.playhead': 'Playhead {time}s',

  'flight.slot.index': 'Slot {index}',
  'flight.source.flight': 'Flight',
  'flight.source.clip': 'Clip',
  'flight.source.manual': 'Manual',
  'flight.source.none': 'Empty',

  'flight.field.position': 'Position',
  'flight.field.yaw': 'Yaw',
  'flight.field.pitch': 'Pitch',
  'flight.field.roll': 'Roll',
  'flight.field.fov': 'FOV',
  'flight.field.zoom': 'Zoom',

  'flight.action.captureLatest': 'Capture latest',
  'flight.action.fromClip': 'From clip',
  'flight.action.clear': 'Clear',
  'flight.action.copy': 'Copy',
  'flight.action.paste': 'Paste',
  'flight.action.apply': 'Apply',
  'flight.action.edit': 'Edit',

  'flight.diff.title': 'Confirm apply',
  'flight.diff.writes': 'Will write {count} field(s)',
  'flight.diff.old': 'Old',
  'flight.diff.new': 'New',
  'flight.diff.confirm': 'Apply',
  'flight.diff.cancel': 'Cancel',
  'flight.diff.none': 'No writable fields.',

  'flight.picker.title': 'Pick a pose slot',
  'flight.picker.empty': 'No pose slot available.',
  'flight.picker.close': 'Close',

  'flight.reason.noClip': 'No selected camera clip.',
  'flight.reason.serviceMissing': 'Pose slot service is not registered.',
}

/** 本插件文案表（按语言合并进工作区 i18n）。 */
export const FLIGHT_MESSAGES: Record<Locale, Record<string, string>> = {
  zh_cn: zhCn,
  en_us: enUs,
}
