/**
 * 贡献注册表（04-01）。
 *
 * 五类注册表共用一张表：面板、页面、抽屉标签、状态项、设置分区。
 * 注册只发生在插件 activate 成功之后；同 ID 重复注册抛错（不静默覆盖）。
 */
import type {
  DrawerTabContribution,
  PanelContribution,
  PageContribution,
  SettingsContribution,
  StatusItemContribution,
} from '../api/contributions.ts'
import type { SlotId } from '../api/ids.ts'
import type {
  DrawerTabRegistry,
  PageRegistry,
  PanelRegistry,
  RegisteredDrawerTab,
  RegisteredPage,
  RegisteredPanel,
  RegisteredSettingsSection,
  RegisteredStatusItem,
  SettingsRegistry,
  StatusItemRegistry,
} from '../api/registries.ts'

interface Entry<T> {
  pluginId: string
  id: string
  contribution: T
}

/** 通用贡献表：`id` 全局唯一，按插件批量卸载。 */
class ContributionTable<T> {
  private readonly items = new Map<string, Entry<T>>()
  private readonly listeners = new Set<() => void>()

  private readonly label: string

  private readonly idOf: (contribution: T) => string

  private readonly onDuplicate: (id: string, firstPluginId: string, secondPluginId: string) => void

  constructor(
    label: string,
    idOf: (contribution: T) => string,
    onDuplicate: (id: string, firstPluginId: string, secondPluginId: string) => void,
  ) {
    this.label = label
    this.idOf = idOf
    this.onDuplicate = onDuplicate
  }

  register(pluginId: string, contribution: T): void {
    const id = this.idOf(contribution)
    const existing = this.items.get(id)
    if (existing !== undefined) {
      this.onDuplicate(id, existing.pluginId, pluginId)
      throw new Error(
        `${this.label} ID 重复: ${id}（已由插件 ${existing.pluginId} 注册，插件 ${pluginId} 再次注册）`,
      )
    }
    this.items.set(id, { pluginId, id, contribution })
    this.emit()
  }

  get(id: string): Entry<T> | undefined {
    return this.items.get(id)
  }

  list(): Entry<T>[] {
    return [...this.items.values()]
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  disposePlugin(pluginId: string): void {
    let changed = false
    for (const [id, entry] of [...this.items.entries()]) {
      if (entry.pluginId === pluginId) {
        this.items.delete(id)
        changed = true
      }
    }
    if (changed) {
      this.emit()
    }
  }

  /** 直接写入（activate 成功后提交暂存贡献用；此时不再重复检查）。 */
  put(entry: Entry<T>): void {
    this.items.set(entry.id, entry)
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

/** 全局重复 ID 报告回调（内核转成诊断）。 */
export type DuplicateReporter = (kind: string, id: string, firstPluginId: string, secondPluginId: string) => void

const noopReporter: DuplicateReporter = () => undefined

export class PanelRegistryImpl implements PanelRegistry {
  private readonly table: ContributionTable<PanelContribution>

  constructor(reporter: DuplicateReporter = noopReporter) {
    this.table = new ContributionTable<PanelContribution>(
      '面板',
      // 面板的全局键是 `pluginId:panelId`（panelId 只在插件内唯一）。
      (contribution) => contribution.panelId,
      (id, first, second) => reporter('panel', id, first, second),
    )
  }

  register(pluginId: string, contribution: PanelContribution): void {
    const key = `${pluginId}:${contribution.panelId}`
    const existing = this.table.get(key)
    if (existing !== undefined) {
      throw new Error(`面板 ID 重复: ${key}（插件 ${pluginId} 重复注册）`)
    }
    this.table.put({ pluginId, id: key, contribution })
  }

  get(pluginId: string, panelId: string): PanelContribution | undefined {
    const entry = this.table.get(`${pluginId}:${panelId}`)
    return entry?.contribution
  }

  has(ref: { pluginId: string; panelId: string }): boolean {
    return this.get(ref.pluginId, ref.panelId) !== undefined
  }

  list(): RegisteredPanel[] {
    return this.table.list().map((entry) => ({ pluginId: entry.pluginId, contribution: entry.contribution }))
  }

  bySlot(slot: SlotId): RegisteredPanel[] {
    return this.list()
      .filter((panel) => panel.contribution.defaultSlot === slot)
      .sort((left, right) => left.contribution.order - right.contribution.order)
  }

  subscribe(listener: () => void): () => void {
    return this.table.subscribe(listener)
  }

  disposePlugin(pluginId: string): void {
    this.table.disposePlugin(pluginId)
  }

  /** 直接登记（供暂存提交用）。 */
  put(entry: RegisteredPanel): void {
    this.table.put({ pluginId: entry.pluginId, id: `${entry.pluginId}:${entry.contribution.panelId}`, contribution: entry.contribution })
  }
}

export class PageRegistryImpl implements PageRegistry {
  private readonly table: ContributionTable<PageContribution>

  constructor(reporter: DuplicateReporter = noopReporter) {
    this.table = new ContributionTable<PageContribution>(
      '页面',
      (contribution) => contribution.pageId,
      (id, first, second) => reporter('page', id, first, second),
    )
  }

  register(pluginId: string, contribution: PageContribution): void {
    this.table.register(pluginId, contribution)
  }

  get(pageId: string): RegisteredPage | undefined {
    const entry = this.table.get(pageId)
    return entry === undefined ? undefined : { pluginId: entry.pluginId, contribution: entry.contribution }
  }

  list(): RegisteredPage[] {
    return this.table.list().map((entry) => ({ pluginId: entry.pluginId, contribution: entry.contribution }))
      .sort((left, right) => left.contribution.order - right.contribution.order)
  }

  subscribe(listener: () => void): () => void {
    return this.table.subscribe(listener)
  }

  disposePlugin(pluginId: string): void {
    this.table.disposePlugin(pluginId)
  }

  put(entry: RegisteredPage): void {
    this.table.put({ pluginId: entry.pluginId, id: entry.contribution.pageId, contribution: entry.contribution })
  }
}

export class DrawerTabRegistryImpl implements DrawerTabRegistry {
  private readonly table: ContributionTable<DrawerTabContribution>

  constructor(reporter: DuplicateReporter = noopReporter) {
    this.table = new ContributionTable<DrawerTabContribution>(
      '抽屉标签',
      (contribution) => contribution.tabId,
      (id, first, second) => reporter('drawerTab', id, first, second),
    )
  }

  register(pluginId: string, contribution: DrawerTabContribution): void {
    this.table.register(pluginId, contribution)
  }

  get(tabId: string): RegisteredDrawerTab | undefined {
    const entry = this.table.get(tabId)
    return entry === undefined ? undefined : { pluginId: entry.pluginId, contribution: entry.contribution }
  }

  list(): RegisteredDrawerTab[] {
    return this.table.list().map((entry) => ({ pluginId: entry.pluginId, contribution: entry.contribution }))
      .sort((left, right) => left.contribution.order - right.contribution.order)
  }

  subscribe(listener: () => void): () => void {
    return this.table.subscribe(listener)
  }

  disposePlugin(pluginId: string): void {
    this.table.disposePlugin(pluginId)
  }

  put(entry: RegisteredDrawerTab): void {
    this.table.put({ pluginId: entry.pluginId, id: entry.contribution.tabId, contribution: entry.contribution })
  }
}

export class StatusItemRegistryImpl implements StatusItemRegistry {
  private readonly table: ContributionTable<StatusItemContribution>

  constructor(reporter: DuplicateReporter = noopReporter) {
    this.table = new ContributionTable<StatusItemContribution>(
      '状态项',
      (contribution) => contribution.itemId,
      (id, first, second) => reporter('statusItem', id, first, second),
    )
  }

  register(pluginId: string, contribution: StatusItemContribution): void {
    this.table.register(pluginId, contribution)
  }

  list(): RegisteredStatusItem[] {
    return this.table.list().map((entry) => ({ pluginId: entry.pluginId, contribution: entry.contribution }))
      .sort((left, right) => left.contribution.order - right.contribution.order)
  }

  subscribe(listener: () => void): () => void {
    return this.table.subscribe(listener)
  }

  disposePlugin(pluginId: string): void {
    this.table.disposePlugin(pluginId)
  }

  put(entry: RegisteredStatusItem): void {
    this.table.put({ pluginId: entry.pluginId, id: entry.contribution.itemId, contribution: entry.contribution })
  }
}

export class SettingsRegistryImpl implements SettingsRegistry {
  private readonly table: ContributionTable<SettingsContribution>

  constructor(reporter: DuplicateReporter = noopReporter) {
    this.table = new ContributionTable<SettingsContribution>(
      '设置分区',
      (contribution) => contribution.sectionId,
      (id, first, second) => reporter('settings', id, first, second),
    )
  }

  register(pluginId: string, contribution: SettingsContribution): void {
    this.table.register(pluginId, contribution)
  }

  list(): RegisteredSettingsSection[] {
    return this.table.list().map((entry) => ({ pluginId: entry.pluginId, contribution: entry.contribution }))
      .sort((left, right) => left.contribution.order - right.contribution.order)
  }

  subscribe(listener: () => void): () => void {
    return this.table.subscribe(listener)
  }

  disposePlugin(pluginId: string): void {
    this.table.disposePlugin(pluginId)
  }

  put(entry: RegisteredSettingsSection): void {
    this.table.put({ pluginId: entry.pluginId, id: entry.contribution.sectionId, contribution: entry.contribution })
  }
}
