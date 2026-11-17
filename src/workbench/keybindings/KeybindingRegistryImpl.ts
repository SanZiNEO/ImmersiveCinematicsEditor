/**
 * 快捷键注册表实现（04-10）。
 *
 * 一张表服务菜单、命令面板与键盘解析：默认规则来自命令定义的 `keybinding`，
 * 用户覆盖只改 chord，不改 scope / `when`。冲突在注册或保存覆盖时抛错。
 */
import type {
  KeybindingRegistryPort,
  KeybindingRule,
  KeyContext,
  KeyEventLike,
  KeyScope,
} from '../api/commands.ts'
import { KEY_SCOPE_PRIORITY } from '../api/commands.ts'
import type { CommandDefinition } from '../api/commands.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import type { ChordPlatform, ChordSpec } from './chord.ts'
import {
  chordSignature,
  formatChord,
  matchChord,
  normalizeChord,
  parseChord,
  resolveModChord,
} from './chord.ts'
import { isChordWhitelistedInEditable, isImeComposing } from './guards.ts'

export interface KeybindingRegistryOptions {
  diagnostics: DiagnosticSink
  platform?: ChordPlatform
}

interface StoredRule {
  readonly rule: KeybindingRule
  readonly chord: ChordSpec
  readonly chordText: string
  /** 平台展开后的物理签名；`Mod+S` 与 win32 的 `Ctrl+S` 相同。 */
  readonly signature: string
  readonly index: number
  readonly synthetic: boolean
}

interface Candidate {
  stored: StoredRule
  effectiveText: string
}

const SCOPES: readonly KeyScope[] = ['global', 'page', 'panel', 'dialog']

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export class KeybindingRegistryImpl implements KeybindingRegistryPort {
  private readonly diagnostics: DiagnosticSink
  readonly platform: ChordPlatform
  private readonly storedRules: StoredRule[] = []
  private readonly overrideChords = new Map<string, string>()
  private readonly syntheticCommands = new Set<string>()
  private nextIndex = 0

  constructor(options: KeybindingRegistryOptions) {
    this.diagnostics = options.diagnostics
    this.platform = options.platform ?? 'win32'
  }

  register(rule: KeybindingRule): void {
    if (typeof rule.commandId !== 'string' || rule.commandId.length === 0) {
      throw new Error('快捷键规则缺少 commandId')
    }
    if (!SCOPES.includes(rule.scope)) {
      throw new Error(`快捷键规则 scope 不合法："${String(rule.scope)}"（命令 "${rule.commandId}"）`)
    }

    const parsed = parseChord(rule.chord)
    if (parsed === null) {
      throw new Error(`快捷键 chord 无法解析："${rule.chord}"（命令 "${rule.commandId}"）`)
    }
    const chordText = normalizeChord(rule.chord)
    const signature = chordSignature(parsed, this.platform)

    for (const existing of this.storedRules) {
      if (existing.rule.scope !== rule.scope) continue
      if (existing.signature !== signature) continue
      if (existing.rule.when !== rule.when) continue
      if (existing.rule.commandId === rule.commandId) {
        // 同一命令重复注册同一条默认规则是幂等的；插件重新激活时不该炸。
        return
      }
      throw new Error(
        `快捷键冲突：scope "${rule.scope}" 的 "${chordText}" 已被命令 ` +
          `"${existing.rule.commandId}" 注册，命令 "${rule.commandId}" 不能重复占用`,
      )
    }

    const normalizedRule: KeybindingRule = {
      chord: chordText,
      commandId: rule.commandId,
      scope: rule.scope,
      ...(rule.priority === undefined ? {} : { priority: rule.priority }),
      ...(rule.when === undefined ? {} : { when: rule.when }),
    }

    this.storedRules.push({
      rule: normalizedRule,
      chord: parsed,
      chordText,
      signature,
      index: this.nextIndex,
      synthetic: false,
    })
    this.nextIndex += 1
  }

  registerFromCommands(commands: readonly CommandDefinition[]): void {
    for (const definition of commands) {
      const keybinding = definition.keybinding
      if (typeof keybinding !== 'string' || keybinding.length === 0) continue
      this.register({
        chord: keybinding,
        commandId: definition.commandId,
        scope: definition.keybindingScope ?? 'global',
      })
    }
  }

  rules(): readonly KeybindingRule[] {
    return this.storedRules.map((stored) => ({ ...stored.rule }))
  }

  setOverride(commandId: string, chord: string | null): void {
    if (typeof commandId !== 'string' || commandId.length === 0) {
      throw new Error('快捷键覆盖缺少 commandId')
    }

    if (chord === null) {
      this.removeSynthetic(commandId)
      const hasDefaults = this.storedRules.some(
        (stored) => !stored.synthetic && stored.rule.commandId === commandId,
      )
      if (hasDefaults) {
        // 空串表示“显式解绑”，持久化后才能和“没有覆盖”区分。
        this.overrideChords.set(commandId, '')
      } else {
        this.overrideChords.delete(commandId)
      }
      return
    }

    const parsed = parseChord(chord)
    if (parsed === null) {
      throw new Error(`快捷键覆盖无法解析："${chord}"（命令 "${commandId}"）`)
    }
    const chordText = normalizeChord(chord)
    const overrideSignature = chordSignature(parsed, this.platform)

    const scopes = new Set<KeyScope>()
    for (const stored of this.storedRules) {
      if (stored.rule.commandId === commandId) scopes.add(stored.rule.scope)
    }
    if (scopes.size === 0) scopes.add('global')

    for (const scope of scopes) {
      for (const existing of this.storedRules) {
        if (existing.rule.scope !== scope) continue
        if (existing.rule.commandId === commandId) continue
        const existingChord = this.effectiveChordText(existing.rule.commandId)
        if (existingChord === null) continue
        const existingSignature = this.signatureOf(existingChord)
        const conflicts =
          existingSignature === null
            ? existingChord === chordText
            : existingSignature === overrideSignature
        if (conflicts) {
          throw new Error(
            `快捷键冲突：scope "${scope}" 的 "${chordText}" 已被命令 ` +
              `"${existing.rule.commandId}" 使用，不能分配给命令 "${commandId}"`,
          )
        }
      }
    }

    const ownRules = this.storedRules.filter((stored) => stored.rule.commandId === commandId)
    if (ownRules.length === 0) {
      const syntheticRule: KeybindingRule = { chord: chordText, commandId, scope: 'global' }
      this.storedRules.push({
        rule: syntheticRule,
        chord: parsed,
        chordText,
        signature: overrideSignature,
        index: this.nextIndex,
        synthetic: true,
      })
      this.nextIndex += 1
      this.syntheticCommands.add(commandId)
    } else {
      for (const stored of ownRules) {
        if (!stored.synthetic) continue
        this.replaceSynthetic(stored, parsed, chordText)
      }
    }

    this.overrideChords.set(commandId, chordText)
  }

  clearOverrides(): void {
    this.overrideChords.clear()
    this.syntheticCommands.clear()
    for (let index = this.storedRules.length - 1; index >= 0; index -= 1) {
      if (this.storedRules[index].synthetic) this.storedRules.splice(index, 1)
    }
  }

  /**
   * 用户覆盖；`chord === ''` 表示该命令被显式解绑（`setOverride(id, null)`）。
   * 持久化层按原样保存即可和“没有覆盖”区分。
   */
  overrides(): ReadonlyArray<{ commandId: string; chord: string }> {
    return [...this.overrideChords.entries()]
      .map(([commandId, chord]) => ({ commandId, chord }))
      .sort((left, right) =>
        left.commandId < right.commandId ? -1 : left.commandId > right.commandId ? 1 : 0,
      )
  }

  chordOf(commandId: string): string | null {
    const override = this.overrideChords.get(commandId)
    if (override !== undefined) return override === '' ? null : override
    const stored = this.storedRules.find(
      (candidate) => !candidate.synthetic && candidate.rule.commandId === commandId,
    )
    return stored === undefined ? null : stored.chordText
  }

  /** 展示用 chord（`Mod` 按平台展开）；设置页 / 菜单可选用。 */
  displayChordOf(commandId: string): string | null {
    const chord = this.chordOf(commandId)
    if (chord === null) return null
    const spec = parseChord(chord)
    return spec === null ? null : formatChord(spec, this.platform)
  }

  resolve(event: KeyEventLike, ctx: KeyContext): KeybindingRule | undefined {
    if (isImeComposing(event) || ctx.composing === true) return undefined

    const dialogOpen = ctx.dialogOpen === true
    const editable = ctx.editable === true
    const candidates: Candidate[] = []

    for (const stored of this.storedRules) {
      const override = this.overrideChords.get(stored.rule.commandId)
      if (override === '') continue
      const effectiveText = override ?? stored.chordText
      const effectiveSpec = override === undefined ? stored.chord : parseChord(override)
      if (effectiveSpec === null) continue

      if (dialogOpen) {
        const dialogRule = stored.rule.scope === 'dialog'
        const globalEsc = stored.rule.scope === 'global' && effectiveText === 'escape'
        if (!dialogRule && !globalEsc) continue
      } else if (stored.rule.scope === 'dialog') {
        continue
      }

      // 面板作用域只在有焦点区域时生效；具体“面板标题聚焦”由规则的 when 决定。
      if (stored.rule.scope === 'panel' && (ctx.region === null || ctx.region === undefined)) {
        continue
      }

      const physical = resolveModChord(effectiveSpec, this.platform)
      if (!matchChord(event, physical)) continue

      if (editable && !isChordWhitelistedInEditable(effectiveText, this.platform)) continue

      if (stored.rule.when !== undefined) {
        try {
          if (!stored.rule.when(ctx)) continue
        } catch (error) {
          this.diagnostics.report({
            severity: 'warning',
            source: 'command',
            message: `快捷键 when 求值失败：命令 "${stored.rule.commandId}"`,
            detail: errorMessage(error),
          })
          continue
        }
      }

      candidates.push({ stored, effectiveText })
    }

    if (candidates.length === 0) return undefined

    candidates.sort((left, right) => {
      const scopeDelta =
        KEY_SCOPE_PRIORITY[right.stored.rule.scope] - KEY_SCOPE_PRIORITY[left.stored.rule.scope]
      if (scopeDelta !== 0) return scopeDelta
      const priorityDelta =
        (right.stored.rule.priority ?? 0) - (left.stored.rule.priority ?? 0)
      if (priorityDelta !== 0) return priorityDelta
      return left.stored.index - right.stored.index
    })

    const winner = candidates[0]
    return { ...winner.stored.rule, chord: winner.effectiveText }
  }

  private effectiveChordText(commandId: string): string | null {
    const override = this.overrideChords.get(commandId)
    if (override !== undefined) return override === '' ? null : override
    const stored = this.storedRules.find(
      (candidate) => !candidate.synthetic && candidate.rule.commandId === commandId,
    )
    return stored === undefined ? null : stored.chordText
  }

  private signatureOf(chordText: string): string | null {
    const spec = parseChord(chordText)
    return spec === null ? null : chordSignature(spec, this.platform)
  }

  private removeSynthetic(commandId: string): void {
    if (!this.syntheticCommands.has(commandId)) return
    this.syntheticCommands.delete(commandId)
    for (let index = this.storedRules.length - 1; index >= 0; index -= 1) {
      const stored = this.storedRules[index]
      if (stored.synthetic && stored.rule.commandId === commandId) {
        this.storedRules.splice(index, 1)
      }
    }
  }

  private replaceSynthetic(stored: StoredRule, spec: ChordSpec, chordText: string): void {
    const replacement: StoredRule = {
      rule: { ...stored.rule, chord: chordText },
      chord: spec,
      chordText,
      signature: chordSignature(spec, this.platform),
      index: stored.index,
      synthetic: true,
    }
    const position = this.storedRules.indexOf(stored)
    if (position >= 0) this.storedRules[position] = replacement
  }
}
