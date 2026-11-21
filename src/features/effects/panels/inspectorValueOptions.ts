/**
 * 右侧 Inspector 的值控件选项（显式 opt-in）。
 *
 * `PropertyValueForm` 继续作为两个面板共用的校验 / 采样 / 提交面；
 * 只有调用方传入本类型时，才启用右侧面板的排版与交互（分段枚举、实用滑杆、
 * 引用形态、长文本、复位、帧间只读）。缺省（不传）时共享面板逐字节保持原行为。
 *
 * 这里只声明显示选项，不复制 schema：字段类型、枚举集合、值域仍由目录决定。
 */
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { CommitOutcome } from '../../../workbench/api/documents.ts'

/** 引用字段的形态下拉与载荷输入。 */
export interface InspectorValueReference {
  /** 可选形态；`value` 是该形态的规范字段值（直接交给真实字段校验）。 */
  choices: readonly { value: string; label: string }[]
  /**
   * 把任意已存字段值归到某个形态（例如把 `@e[type=cow]` 归为 `@p` 形态）。
   * 用于回显下拉选中项并保留已有自定义值。
   */
  preset(value: string): string
  /** 形态对应的载荷输入（仅该形态适用时显示）。 */
  payloads?: Readonly<Record<string, {
    label: string
    placeholder?: string
    /** 载荷前缀；输入会拼在它后面，例如 `block:`。 */
    prefix?: string
  }>>
}

/** 等待父面板确认的写入既未提交，也未被拒绝。 */
export type InspectorCommitOutcome = CommitOutcome | { ok: false; pending: true }

/** 右侧 Inspector 的值控件选项。 */
export interface InspectorValueOptions {
  /** 枚举原值 → 操作词（例如 `relative` → `相对位置`）。 */
  labels?: Readonly<Record<string, string>>
  /** 枚举用分段按钮而不是下拉。 */
  segmented?: boolean
  /**
   * 实用滑杆区间 `[min, max, step]`。
   * 它只是编辑区间，不是 schema 值域；精确输入仍按目录校验。
   */
  range?: readonly [number, number, number]
  /** 文本使用多行输入。 */
  multiline?: boolean
  /** 多行文本把标签与输入框分成上下两行；缺省仍按值列排版。 */
  stackedLabel?: boolean
  /** 文本 / 引用控件的占位提示。 */
  placeholder?: string
  /** 引用字段的形态下拉与载荷输入。 */
  reference?: InspectorValueReference
  /**
   * 右栏专用提交钩子：父级可用它包裹命令（例如位置基准切换时的帧对齐与守卫确认）。
   *
   * 收到完整命令序列（含提交前缀）；需要确认时返回 pending，由父面板独立呈现。
   * 不提供时仍走 `ctx.commands.commitBatch` / `commit` 的原路径。
   */
  commit?: (commands: DocCommand[], coalesceKey: string) => InspectorCommitOutcome
}
