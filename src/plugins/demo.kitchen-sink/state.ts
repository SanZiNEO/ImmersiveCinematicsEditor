/**
 * `demo.kitchen-sink` 的插件本地状态（04-11）。
 *
 * 这里只放 demo 自己的东西：ping 计数、主题翻转指针、demo 开关，以及把它们
 * 接到宿主服务上的订阅。面板/设置分区直接读这里的 ref，不 import 全局 store。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { PanelContext, PluginContext } from '../../workbench/api/context.ts'
import type { PreferencesApi } from '../../workbench/api/preferences.ts'
import type { ThemeApi } from '../../workbench/api/theme.ts'
import {
  DOCUMENT_SERVICE,
  PREFERENCES_SERVICE,
  SELECTION_SERVICE,
  THEME_SERVICE,
} from '../../workbench/api/tokens.ts'
import { MIDNIGHT_THEME_FILE, SEPIA_THEME_FILE } from './themes/index.ts'

/** 插件 ID（manifest / 服务 / 诊断共用一份）。 */
export const DEMO_PLUGIN_ID = 'demo.kitchen-sink'

/** 插件版本（manifest 与设置分区共用一份）。 */
export const DEMO_PLUGIN_VERSION = '0.1.0'

/** demo 设置开关在 `preferences.plugins['demo.kitchen-sink']` 里的键。 */
export const DEMO_TOGGLE_KEY = 'demoToggle'

/** `demo.command.ping` 的计数；`demo.status.plugin` 与效果面板都显示它。 */
export const pingCount = ref(0)

/**
 * 下一次 `demo.command.toggleTheme` 要应用的主题：0 = sepia，1 = midnight。
 *
 * `bindDemoState` 订阅主题服务，应用成功后把指针翻到另一个，保证连续执行
 * 命令时两个主题来回切，而不是总落到同一个。
 */
export const themeFlip = ref<0 | 1>(0)

/** 只属于本插件的开关；由 `demo.settings.section` 修改。 */
export const demoToggle = ref(false)

/** 偏好服务是否可用；不可用时设置分区禁用开关并说明原因。 */
export const demoPreferenceReady = ref(false)

/** 插件的 demo 主题 ID（按注册顺序）。 */
export const DEMO_THEME_IDS = {
  sepia: SEPIA_THEME_FILE.definition.id,
  midnight: MIDNIGHT_THEME_FILE.definition.id,
} as const

/** 插件内保存一份当前偏好服务引用（设置分区不经过 PanelContext）。 */
let preferencesApi: PreferencesApi | null = null

/** `demo.command.ping`：状态区计数 +1。 */
export function bumpPing(): void {
  pingCount.value += 1
}

/** 下一次要切到的 demo 主题 ID。 */
export function nextDemoThemeId(): string {
  return themeFlip.value === 0 ? DEMO_THEME_IDS.sepia : DEMO_THEME_IDS.midnight
}

/** 把翻转指针同步到当前主题（不是 demo 主题时保持指针，下一次仍切到指针指向的 demo 主题）。 */
export function syncThemeFlip(currentThemeId: string): void {
  if (currentThemeId === DEMO_THEME_IDS.sepia) {
    themeFlip.value = 1
    return
  }
  if (currentThemeId === DEMO_THEME_IDS.midnight) {
    themeFlip.value = 0
  }
}

/** 从偏好里读回 demo 开关。 */
function readDemoToggle(prefs: PreferencesApi): void {
  const values = prefs.pluginValues(DEMO_PLUGIN_ID)
  demoToggle.value = values[DEMO_TOGGLE_KEY] === true
}

/**
 * 写 demo 开关。
 *
 * 偏好服务可用时同步落盘（`PreferencesStore` 负责 debounce + 原子写）；
 * 不可用时保持内存值并由设置分区显示禁用原因，不伪造持久化。
 */
export function setDemoToggle(next: boolean): void {
  demoToggle.value = next
  preferencesApi?.setPluginValue(DEMO_PLUGIN_ID, DEMO_TOGGLE_KEY, next)
}

/** 插件状态订阅的释放句柄。 */
export interface DemoStateBinding {
  dispose(): void
}

/**
 * 把插件状态接到宿主服务：主题订阅 + 偏好读取。
 *
 * 只做轻量初始化（读当前值、挂订阅），不触发文档/布局/网络工作。
 */
export function bindDemoState(ctx: PluginContext): DemoStateBinding {
  const disposers: Array<() => void> = []

  const theme: ThemeApi | undefined = ctx.services.get(THEME_SERVICE)
  if (theme !== undefined) {
    syncThemeFlip(theme.current().id)
    disposers.push(theme.subscribe((next) => syncThemeFlip(next.id)))
  }

  const prefs: PreferencesApi | undefined = ctx.services.get(PREFERENCES_SERVICE)
  if (prefs !== undefined) {
    preferencesApi = prefs
    demoPreferenceReady.value = true
    readDemoToggle(prefs)
    disposers.push(prefs.subscribe(() => readDemoToggle(prefs)))
  }

  return {
    dispose: () => {
      for (const dispose of disposers) {
        dispose()
      }
      disposers.length = 0
      if (preferencesApi === prefs) {
        preferencesApi = null
        demoPreferenceReady.value = false
      }
    },
  }
}

/**
 * 面板刷新信号。
 *
 * `PanelContext` 的 `selection` / `clipKeys` / `docRevision` 是实时 getter，不是 ref；
 * 面板用宿主公开的 `SelectionServicePort.subscribe` 与 `DocumentService.subscribe`
 * 把变化折成一个版本号，再在 `computed` 里读上下文快照。
 */
export function useDemoRevision(ctx: PanelContext): Ref<number> {
  const revision = ref(0)
  const disposers: Array<() => void> = []

  onMounted(() => {
    const selection = ctx.services.get(SELECTION_SERVICE)
    if (selection !== undefined) {
      disposers.push(
        selection.subscribe(() => {
          revision.value += 1
        }),
      )
    }
    const documentService = ctx.services.get(DOCUMENT_SERVICE)
    if (documentService !== undefined) {
      disposers.push(
        documentService.subscribe(() => {
          revision.value += 1
        }),
      )
    }
  })

  onBeforeUnmount(() => {
    for (const dispose of disposers) {
      dispose()
    }
    disposers.length = 0
  })

  return revision
}
