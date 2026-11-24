<script setup lang="ts">
/** 首启引导 surface：内容复用 OnboardingSection，状态落盘只在这里。 */
import { ref } from 'vue'

import {
  applyOnboardingOutcome,
  type OnboardingOutcome,
} from '../preferences/onboarding.ts'
import { useI18n, usePreferences } from './useWorkbench.ts'
import OnboardingSection from './OnboardingSection.vue'
import WorkbenchDialog from './WorkbenchDialog.vue'

const emit = defineEmits<{ close: [] }>()
const i18n = useI18n()
const preferences = usePreferences()
const closing = ref(false)

async function finish(outcome: OnboardingOutcome): Promise<void> {
  if (closing.value) {
    return
  }
  closing.value = true
  const settings = applyOnboardingOutcome(preferences.get().settings, outcome)
  preferences.patch({ settings })
  try {
    await preferences.flush()
  } finally {
    emit('close')
  }
}

function complete(): void {
  void finish('complete')
}

function dismiss(): void {
  void finish('dismiss')
}
</script>

<template>
  <WorkbenchDialog
    :title="i18n.t('onboarding.title')"
    dialog-id="onboarding-dialog"
    width="720px"
    class="onboarding-dialog"
    @close="dismiss"
  >
    <OnboardingSection @complete="complete" @skip="dismiss" />
  </WorkbenchDialog>
</template>
