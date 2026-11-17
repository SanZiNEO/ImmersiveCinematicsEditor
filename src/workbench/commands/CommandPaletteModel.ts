/**
 * 命令面板模型（04-10）。
 *
 * 纯函数：过滤与分组不依赖 Vue / DOM；面板组件只负责渲染与键盘选择。
 */
import type { RegisteredCommand } from '../api/commands.ts'

/** 命令面板搜索字段。接受 `RegisteredCommand`、`MenuState` 或自定义投影。 */
export interface PaletteCommandFields {
  commandId: string
  titleKey: string
  category: string
}

/** 分组结果（保持组内原顺序；组按 category 字典序）。 */
export interface PaletteGroup<T> {
  category: string
  items: T[]
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function readPaletteFields(item: unknown): PaletteCommandFields {
  if (item === null || typeof item !== 'object') {
    return { commandId: '', titleKey: '', category: '' }
  }

  const record = item as Record<string, unknown>
  const nested = record.definition
  if (nested !== null && typeof nested === 'object') {
    const definition = nested as Record<string, unknown>
    return {
      commandId: readString(definition, 'commandId'),
      titleKey: readString(definition, 'titleKey'),
      category: readString(definition, 'category'),
    }
  }

  const label = readString(record, 'titleKey')
  return {
    commandId: readString(record, 'commandId'),
    // MenuState 用 `label` 承载 titleKey。
    titleKey: label.length > 0 ? label : readString(record, 'label'),
    category: readString(record, 'category'),
  }
}

/**
 * 按 titleKey / category / commandId 做不区分大小写的包含匹配。
 * 空查询返回全部命令（保持原顺序）。
 */
export function filterCommands<T>(items: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...items]

  return items.filter((item) => {
    const fields = readPaletteFields(item)
    if (
      fields.commandId.length === 0 &&
      fields.titleKey.length === 0 &&
      fields.category.length === 0
    ) {
      return false
    }
    return (
      fields.commandId.toLowerCase().includes(needle) ||
      fields.titleKey.toLowerCase().includes(needle) ||
      fields.category.toLowerCase().includes(needle)
    )
  })
}

/** 按 category 分组；组内与组间都保持首次出现顺序。 */
export function groupByCategory<T>(items: readonly T[]): PaletteGroup<T>[] {
  const groups = new Map<string, T[]>()

  for (const item of items) {
    const category = readPaletteFields(item).category
    const bucket = groups.get(category)
    if (bucket === undefined) {
      groups.set(category, [item])
    } else {
      bucket.push(item)
    }
  }

  return [...groups.entries()].map(([category, grouped]) => ({ category, items: grouped }))
}

/** 从已注册命令构建面板项的便捷投影（供 shell 使用）。 */
export function commandsToPaletteFields(
  commands: readonly RegisteredCommand[],
): PaletteCommandFields[] {
  return commands.map((command) => ({
    commandId: command.definition.commandId,
    titleKey: command.definition.titleKey,
    category: command.definition.category,
  }))
}
