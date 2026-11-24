/** 核心主题 token 的人类可读标签与输入归一。 */
import { OVERRIDABLE_TOKENS } from '../api/theme.ts'
import type { CoreThemeToken } from '../api/theme.ts'

const LABEL_KEYS: Record<CoreThemeToken, string> = {
  'bg-app': 'theme.token.bg-app',
  'bg-panel': 'theme.token.bg-panel',
  'bg-raised': 'theme.token.bg-raised',
  'bg-hover': 'theme.token.bg-hover',
  'bg-selected': 'theme.token.bg-selected',
  text: 'theme.token.text',
  'text-secondary': 'theme.token.text-secondary',
  'text-muted': 'theme.token.text-muted',
  border: 'theme.token.border',
  'border-strong': 'theme.token.border-strong',
  accent: 'theme.token.accent',
  focus: 'theme.token.focus',
  success: 'theme.token.success',
  warning: 'theme.token.warning',
  error: 'theme.token.error',
  'error-bg': 'theme.token.error-bg',
  'selection-outline': 'theme.token.selection-outline',
}

export const THEME_TOKEN_ROWS: ReadonlyArray<{
  token: CoreThemeToken
  labelKey: string
}> = OVERRIDABLE_TOKENS.map((token) => ({
  token,
  labelKey: LABEL_KEYS[token],
}))

export function normalizeOverrideInput(raw: string, effectiveValue: string): string {
  const trimmed = raw.trim()
  return trimmed === effectiveValue ? '' : trimmed
}
