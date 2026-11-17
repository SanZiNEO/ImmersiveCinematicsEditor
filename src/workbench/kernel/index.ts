/**
 * 插件内核（04-01）公共入口。
 *
 * 内核只依赖 `../api/*`；不 import 任何 `plugins/*\/panels` 业务组件。
 */
export * from './DiagnosticsStore.ts'
export * from './ServiceRegistryImpl.ts'
export * from './DisposableStoreImpl.ts'
export * from './CollectionRegistries.ts'
export * from './ManifestGraph.ts'
export * from './PluginRegistry.ts'
