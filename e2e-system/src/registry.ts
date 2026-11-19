/**
 * 插件契约（docs/13-e2e-system.md §4）。
 *
 * 每个插件声明 capabilities 与可路由的 ops；`available()` 缺能力时返回具体缺失项，
 * 运行期记 BLOCKED——禁止 SKIP、禁止伪造通过。
 */
import type { Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright-core'

import type { ResolvedConfig } from './config.ts'

export interface Availability {
  ok: boolean
  missing: string[]
}

export interface StepResult {
  ok: boolean
  value?: unknown
  summary?: string
  expected?: unknown
  actual?: unknown
  reason?: string
  /** 运行期发现能力/检查缺失：记 BLOCKED（不是 FAIL），并在 missing 写具体缺失项。 */
  blocked?: boolean
  missing?: string[]
}

export interface EvidenceEntry {
  kind: string
  path: string
  note?: string
  hash?: string
}

export interface PluginContext {
  runId: string
  artifactsDir: string
  config: ResolvedConfig
  /** 当前套件声明的插件 id 列表。 */
  suitePlugins: string[]
  params: Record<string, unknown>
  /** 宿主插件注入的编辑器页面；未启动时为 null。 */
  page: Page | null
  /** 宿主插件注入的 Electron 应用；未启动时为 null。 */
  app: ElectronApplication | null
  log: (line: string) => void
  attachEvidence: (entry: EvidenceEntry) => void
  cleanupErrors: string[]
}

export interface E2ePlugin {
  id: string
  /** 本插件提供的能力标识，如 host.electron / webui.fake。 */
  capabilities: string[]
  /** 可由本插件处理的 op 名。 */
  ops: string[]
  available(ctx: PluginContext): Promise<Availability>
  /** 可选：按能力做更细的可用性探测（缺什么记什么）。 */
  capabilityAvailable?(ctx: PluginContext, capability: string): Promise<Availability>
  setup?(ctx: PluginContext): Promise<void>
  teardown?(): Promise<void>
  invoke(ctx: PluginContext, op: string, params: Record<string, unknown>): Promise<StepResult>
}

export class PluginRegistry {
  private readonly plugins = new Map<string, E2ePlugin>()

  register(plugin: E2ePlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`插件重复注册: ${plugin.id}`)
    }
    this.plugins.set(plugin.id, plugin)
  }

  get(id: string): E2ePlugin | undefined {
    return this.plugins.get(id)
  }

  all(): E2ePlugin[] {
    return [...this.plugins.values()]
  }

  /** 按 op 名找到处理插件。 */
  routeOp(op: string): E2ePlugin | undefined {
    for (const plugin of this.plugins.values()) {
      if (plugin.ops.includes(op)) return plugin
    }
    return undefined
  }

  /** 按能力标识找到提供插件。 */
  capabilityProvider(capability: string): E2ePlugin | undefined {
    for (const plugin of this.plugins.values()) {
      if (plugin.capabilities.includes(capability)) return plugin
    }
    return undefined
  }
}
