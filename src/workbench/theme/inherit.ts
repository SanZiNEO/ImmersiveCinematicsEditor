/**
 * 主题 token 继承（04-07）。
 *
 * 只做一件事：把缺失的核心 token 从**同 appearance 的内置基础主题**补一层。
 * 不递归、不跨 appearance、不引用其他插件主题。
 */
import { CORE_THEME_TOKENS, OPTIONAL_THEME_TOKENS } from '../api/theme.ts'
import type { CoreThemeToken, ThemeDefinition, ThemeTokens } from '../api/theme.ts'

/** 结果中缺失的核心 token（继承后仍缺）。 */
export function missingCoreTokens(tokens: Partial<ThemeTokens>): CoreThemeToken[] {
  return CORE_THEME_TOKENS.filter((token) => tokens[token] === undefined)
}

/**
 * 合并主题 token 与基础主题。
 *
 * `baseline` 只在 `appearance` 相同时生效；基础主题本身是否完整不再向下追溯。
 * 可选项（shadow/overlay/scrollbar）不继承，只取主题自己的值。
 */
export function resolveTokens(
  theme: ThemeDefinition,
  baseline: ThemeDefinition | undefined,
): Partial<ThemeTokens> {
  const merged: Partial<ThemeTokens> = {}
  if (baseline !== undefined && baseline.appearance === theme.appearance) {
    for (const token of CORE_THEME_TOKENS) {
      const value = baseline.tokens[token]
      if (value !== undefined) {
        merged[token] = value
      }
    }
  }
  for (const token of CORE_THEME_TOKENS) {
    const value = theme.tokens[token]
    if (value !== undefined) {
      merged[token] = value
    }
  }
  for (const token of OPTIONAL_THEME_TOKENS) {
    const value = theme.tokens[token]
    if (value !== undefined) {
      merged[token] = value
    }
  }
  return merged
}
