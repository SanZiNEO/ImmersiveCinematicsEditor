/** 快捷键设置表的行投影：只保留存在真实键位信号的命令。 */
import type { KeybindingRule, KeyScope, RegisteredCommand } from '../api/commands.ts'
import type { KeybindingOverride } from '../api/preferences.ts'
import { normalizeChord } from '../keybindings/chord.ts'

export type ShortcutRowState = 'default' | 'dynamic' | 'overridden' | 'cleared'

export interface ShortcutRowsInput {
  readonly commands: readonly RegisteredCommand[]
  readonly rules: readonly KeybindingRule[]
  readonly overrides: readonly KeybindingOverride[]
}

export interface ShortcutRow {
  readonly commandId: string
  readonly titleKey: string
  readonly category: string
  readonly scope: KeyScope
  readonly chord: string | null
  readonly state: ShortcutRowState
}

export function shortcutRows(input: ShortcutRowsInput): ShortcutRow[] {
  const firstRule = new Map<string, KeybindingRule>()
  for (const rule of input.rules) {
    if (!firstRule.has(rule.commandId)) {
      firstRule.set(rule.commandId, rule)
    }
  }
  const overrideByCommand = new Map(input.overrides.map((entry) => [entry.commandId, entry.chord]))

  const rows: ShortcutRow[] = []
  for (const entry of input.commands) {
    const definition = entry.definition
    const commandId = definition.commandId
    const defaultChord = normalizeChord(definition.keybinding ?? '')
    const rule = firstRule.get(commandId)
    const override = overrideByCommand.get(commandId)
    const hasDefault = defaultChord !== ''
    const hasRule = rule !== undefined

    if (override === undefined && !hasDefault && !hasRule) {
      continue
    }
    if (override === '' && !hasDefault && !hasRule) {
      continue
    }

    const scope = rule?.scope ?? definition.keybindingScope ?? 'global'
    let state: ShortcutRowState
    let chord: string | null
    if (override === '') {
      state = 'cleared'
      chord = null
    } else if (override !== undefined) {
      state = 'overridden'
      chord = normalizeChord(override) || override
    } else if (hasDefault) {
      state = 'default'
      chord = defaultChord
    } else if (rule !== undefined) {
      state = 'dynamic'
      chord = normalizeChord(rule.chord) || rule.chord
    } else {
      continue
    }

    rows.push({
      commandId,
      titleKey: definition.titleKey,
      category: definition.category,
      scope,
      chord,
      state,
    })
  }
  return rows
}

export function findShortcutConflict(
  rows: readonly ShortcutRow[],
  commandId: string,
  chord: string,
  scope: KeyScope,
): string | null {
  const normalized = normalizeChord(chord)
  if (normalized === '') {
    return null
  }
  for (const row of rows) {
    if (row.commandId === commandId || row.scope !== scope || row.chord === null) {
      continue
    }
    if (normalizeChord(row.chord) === normalized) {
      return row.commandId
    }
  }
  return null
}
