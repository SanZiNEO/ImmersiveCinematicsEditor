/**
 * 脚本参数面板的显示分组与中文标签（检查器改版）。
 *
 * 这里只放**界面组织**：字段事实（类型 / 默认值 / 枚举 / 范围）仍来自 02 目录；
 * 写入仍走 `meta.set`。分组顺序对应设计稿的「基本信息 / 播放行为 / 输入与监听 /
 * 画布与游戏界面 / 行为」；目录里新增的字段会落到「扩展字段」，不会被丢掉。
 */
import type { FieldEntry } from '../../core/schema/types.ts'

/** 分组定义（`open` = 默认展开）。 */
export interface ScriptFieldGroup {
  id: string
  label: string
  keys: readonly string[]
  open: boolean
}

export const SCRIPT_FIELD_GROUPS: readonly ScriptFieldGroup[] = [
  {
    id: 'basic',
    label: '基本信息',
    keys: ['name', 'id', 'author', 'description'],
    open: true,
  },
  {
    id: 'playback',
    label: '播放行为',
    keys: [
      'play_mode', 'priority', 'interruptible', 'skippable', 'skip_vote_ratio',
      'hold_at_end', 'macro_loop', 'macro_loop_count', 'macro_loop_mode',
    ],
    open: false,
  },
  {
    id: 'input',
    label: '输入与监听',
    keys: ['listener', 'block_keyboard', 'block_mouse', 'block_mob_ai', 'pause_when_game_paused'],
    open: false,
  },
  {
    id: 'canvas',
    label: '画布与游戏界面',
    keys: ['dimension', 'base_resolution', 'screen_layers'],
    open: false,
  },
  {
    id: 'behavior',
    label: '行为',
    keys: ['triggers', 'trigger_poll_interval'],
    open: false,
  },
]

/** 已归入分组的字段键（其余进「扩展字段」）。 */
export const SCRIPT_GROUPED_KEYS: ReadonlySet<string> = new Set(
  SCRIPT_FIELD_GROUPS.flatMap((group) => group.keys),
)

/** 字段中文标签；未登记时用字段键（只用于未知扩展字段）。 */
const SCRIPT_FIELD_LABELS: Readonly<Record<string, string>> = {
  name: '脚本名称',
  id: '脚本 ID',
  author: '作者',
  description: '说明',
  play_mode: '播放模式',
  priority: '优先级',
  interruptible: '可被打断',
  skippable: '允许跳过',
  skip_vote_ratio: '跳过投票比例',
  hold_at_end: '保持结尾',
  macro_loop: '整段循环',
  macro_loop_count: '循环次数',
  macro_loop_mode: '循环方式',
  listener: '音频监听点',
  block_keyboard: '屏蔽键盘',
  block_mouse: '屏蔽鼠标',
  block_mob_ai: '冻结生物 AI',
  pause_when_game_paused: '随游戏暂停',
  dimension: '播放维度',
  base_resolution: '基准分辨率',
  screen_layers: '游戏界面层',
  triggers: '触发器',
  trigger_poll_interval: '脚本级轮询间隔',
}

/** 枚举值中文显示（只影响下拉框文案，不改变写入值）。 */
const SCRIPT_ENUM_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  play_mode: { parallel: '并行', exclusive: '独占', interruptible: '可打断' },
  macro_loop_mode: { repeat: '重复', pingpong: '往返' },
  listener: { player: '玩家', camera: '相机' },
}

export function scriptFieldLabel(field: FieldEntry): string {
  return SCRIPT_FIELD_LABELS[field.key] ?? field.key
}

export function scriptEnumLabel(key: string, value: string): string {
  return SCRIPT_ENUM_LABELS[key]?.[value] ?? value
}

export function scriptEnumOptions(field: FieldEntry): string[] {
  return field.enumValues ?? []
}