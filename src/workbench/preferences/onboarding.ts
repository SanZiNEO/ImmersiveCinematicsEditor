/**
 * 首启引导判定与结果落盘语义。
 *
 * 完成 = 当前版本已看且恢复自动提示；跳过/关闭 = 当前用户明确免打扰。
 */
import type { PreferencesSettingsState } from '../api/preferences.ts'
import { ONBOARDING_VERSION } from '../api/preferences.ts'

export type OnboardingOutcome = 'complete' | 'dismiss'

export function shouldOpenOnboarding(settings: Readonly<PreferencesSettingsState>): boolean {
  const version = typeof settings.onboardingVersion === 'number'
    && Number.isFinite(settings.onboardingVersion)
    ? settings.onboardingVersion
    : 0
  return version < ONBOARDING_VERSION && settings.onboardingDismissed !== true
}

export function applyOnboardingOutcome(
  settings: Readonly<PreferencesSettingsState>,
  outcome: OnboardingOutcome,
): PreferencesSettingsState {
  if (outcome === 'dismiss') {
    return {
      ...settings,
      onboardingDismissed: true,
    }
  }
  return {
    ...settings,
    onboardingVersion: ONBOARDING_VERSION,
    onboardingDismissed: false,
  }
}
