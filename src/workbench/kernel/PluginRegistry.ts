/**
 * 插件注册表与激活（04-01）。
 *
 * 顺序固定：
 * 1. 校验 manifest 结构 / ID 唯一 / API 版本 / 依赖无环（`ManifestGraph`）；
 * 2. 按拓扑顺序激活；每个插件一个独立 `PluginContext` + `DisposableStore`；
 * 3. `activate` 成功后才把该插件贡献提交到全局注册表；失败则丢弃并标记 `failed`；
 * 4. 依赖未激活 → 本插件 `skipped`，错误写明依赖链；
 * 5. 卸载按激活逆序 dispose，单个抛错只记诊断。
 *
 * 内核只认 `pluginId`；不 import 任何面板组件。
 */
import type {
  CommandContribution,
  DrawerTabContribution,
  PageContribution,
  PanelContribution,
  PluginManifest,
  SettingsContribution,
  StatusItemContribution,
} from '../api/contributions.ts'
import type { PluginContext } from '../api/context.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import type { ManifestEntry, ManifestIssue, ManifestPlan } from './ManifestGraph.ts'
import { planManifests } from './ManifestGraph.ts'

/** 插件状态。 */
export type PluginStatus = 'pending' | 'active' | 'failed' | 'skipped'

/** 一个插件的运行状态。 */
export interface PluginState {
  id: string
  name: string
  version: string
  source: string
  status: PluginStatus
  error?: string
}

/** 暂存贡献：`activate` 期间只收集，不进入全局注册表。 */
export interface ContributionStage {
  pluginId: string
  /** manifest 声明的命令 + `activate` 期间注册的命令（同一份数组，成功后一次提交）。 */
  commands: CommandContribution[]
  panels: PanelContribution[]
  pages: PageContribution[]
  drawerTabs: DrawerTabContribution[]
  statusItems: StatusItemContribution[]
  settings: SettingsContribution[]
  /** 主题贡献的 `path` 由宿主按插件目录解析；内核只透传贡献。 */
  themes: Array<{ themeId: string; labelKey: string; appearance: 'dark' | 'light' | 'high-contrast'; path: string; preview?: { bg: string; panel: string; text: string; accent: string } }>
}

/** 激活宿主：由应用提供上下文工厂与贡献提交。 */
export interface PluginActivationHost {
  /** 创建一个插件上下文；`contribute*` 写入 stage。 */
  createContext(manifest: PluginManifest, stage: ContributionStage): PluginContext
  /** 提交暂存贡献（重复 ID 抛错 → 该插件按失败处理）。 */
  commitStage(stage: ContributionStage): void
  /** 回滚该插件已写入的贡献与服务（防半注册）。 */
  rollbackPlugin(pluginId: string): void
  /** 释放插件上下文里的 disposables（逆序）。 */
  disposeContext(pluginId: string): void
}

export interface PluginRegistryOptions {
  diagnostics: DiagnosticSink
  host: PluginActivationHost
}

/** 新建一个空的暂存贡献。 */
function emptyStage(pluginId: string): ContributionStage {
  return {
    pluginId,
    commands: [],
    panels: [],
    pages: [],
    drawerTabs: [],
    statusItems: [],
    settings: [],
    themes: [],
  }
}

/** 把 manifest 声明的贡献放进 stage（先声明的先提交）。 */
function seedStage(manifest: PluginManifest, stage: ContributionStage): void {
  const contributions = manifest.contributes
  stage.commands.push(...(contributions.commands ?? []))
  stage.panels.push(...(contributions.panels ?? []))
  stage.pages.push(...(contributions.pages ?? []))
  stage.drawerTabs.push(...(contributions.drawerTabs ?? []))
  stage.statusItems.push(...(contributions.statusItems ?? []))
  stage.settings.push(...(contributions.settings ?? []))
  stage.themes.push(...(contributions.themes ?? []))
}

/** 插件注册表。 */
export class PluginRegistry {
  private readonly diagnostics: DiagnosticSink
  private readonly host: PluginActivationHost
  private readonly entries = new Map<string, ManifestEntry>()
  private readonly stateById = new Map<string, PluginState>()
  private activationOrder: string[] = []
  private plan: ManifestPlan | null = null
  private disposed = false

  constructor(options: PluginRegistryOptions) {
    this.diagnostics = options.diagnostics
    this.host = options.host
  }

  /** 载入 manifest 清单：只做校验与排序，不激活。 */
  load(entries: readonly ManifestEntry[]): ManifestPlan {
    const plan = planManifests(entries)
    this.plan = plan
    this.entries.clear()
    this.stateById.clear()
    for (const entry of entries) {
      const id = entry.manifest.id
      this.entries.set(id, entry)
      const failure = plan.failed.get(id)
      this.stateById.set(id, {
        id,
        name: entry.manifest.name,
        version: entry.manifest.version,
        source: entry.source,
        status: failure === undefined ? 'pending' : 'failed',
        ...(failure === undefined ? {} : { error: failure }),
      })
    }
    for (const issue of plan.issues) {
      this.reportIssue(issue)
    }
    return plan
  }

  /** 按拓扑顺序激活全部插件。 */
  async activateAll(): Promise<void> {
    const plan = this.plan
    if (plan === null) {
      return
    }
    for (const entry of plan.order) {
      const manifest = entry.manifest
      const state = this.stateById.get(manifest.id)
      if (state === undefined || state.status !== 'pending') {
        continue
      }
      const blocked = (manifest.requires ?? []).find((dependency) => this.stateById.get(dependency)?.status !== 'active')
      if (blocked !== undefined) {
        const dependencyState = this.stateById.get(blocked)
        const reason = `依赖 ${blocked} 未激活（状态: ${dependencyState?.status ?? '未注册'}）`
        state.status = 'skipped'
        state.error = reason
        this.diagnostics.report({
          severity: 'error',
          source: 'plugin',
          pluginId: manifest.id,
          message: `插件跳过: ${manifest.id}`,
          detail: reason,
        })
        continue
      }

      const stage = emptyStage(manifest.id)
      seedStage(manifest, stage)
      try {
        const context = this.host.createContext(manifest, stage)
        await manifest.activate(context)
        this.host.commitStage(stage)
        state.status = 'active'
        this.activationOrder.push(manifest.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        state.status = 'failed'
        state.error = message
        this.host.rollbackPlugin(manifest.id)
        this.diagnostics.report({
          severity: 'error',
          source: 'plugin',
          pluginId: manifest.id,
          message: `插件激活失败: ${manifest.id}`,
          detail: message,
        })
      }
    }
  }

  /** 全部插件状态（按载入顺序）。 */
  states(): PluginState[] {
    return [...this.stateById.values()]
  }

  /** 单个插件状态。 */
  state(pluginId: string): PluginState | undefined {
    return this.stateById.get(pluginId)
  }

  /** 是否已激活。 */
  isActive(pluginId: string): boolean {
    return this.stateById.get(pluginId)?.status === 'active'
  }

  /** 激活顺序（卸载逆序用）。 */
  activeOrder(): string[] {
    return [...this.activationOrder]
  }

  /** 失败插件计数（状态区徽标）。 */
  failureCount(): number {
    return this.states().filter((state) => state.status === 'failed' || state.status === 'skipped').length
  }

  /** 卸载：按激活逆序释放。 */
  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const pluginId of [...this.activationOrder].reverse()) {
      try {
        this.host.disposeContext(pluginId)
        this.host.rollbackPlugin(pluginId)
      } catch (error) {
        this.diagnostics.report({
          severity: 'warning',
          source: 'plugin',
          pluginId,
          message: `插件卸载抛错: ${pluginId}`,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
      const state = this.stateById.get(pluginId)
      if (state !== undefined) {
        state.status = 'pending'
      }
    }
    this.activationOrder = []
  }

  private reportIssue(issue: ManifestIssue): void {
    this.diagnostics.report({
      severity: issue.severity === 'error' ? 'error' : 'warning',
      source: 'plugin',
      message: issue.message,
      ...(issue.pluginId === undefined ? {} : { pluginId: issue.pluginId }),
      ...(issue.source === undefined ? {} : { detail: issue.source }),
    })
  }
}
