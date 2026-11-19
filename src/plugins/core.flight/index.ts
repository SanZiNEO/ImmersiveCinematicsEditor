/**
 * `core.flight` 激活入口（12-08）。
 *
 * 激活阶段把会话级九槽库注册进 ServiceRegistry：模板面板（12-06）与曲线工具（12-07）
 * 通过 `ctx.services.get(POSE_BANK_SERVICE)` 取同一实例，不在面板里 new 新库。
 * 激活本身不读文档、不发网络消息；装配细节在 `features/flight/service.ts`。
 */
import type { PluginContext } from '../../workbench/api/context.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE } from '../../workbench/api/tokens.ts'
import type { DocumentService } from '../../workbench/api/documents.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'
import { POSE_BANK_SERVICE } from '../../features/flight/public.ts'
import { createFlightService } from '../../features/flight/service.ts'

/** 插件激活：注册姿态槽服务。 */
export default function activate(ctx: PluginContext): void {
  const catalog = ctx.services.get<CatalogIndex>(CATALOG_SERVICE)
  const docs = ctx.services.get<DocumentService>(DOCUMENT_SERVICE)
  ctx.services.provide(POSE_BANK_SERVICE, createFlightService(docs, catalog))
}

export { FLIGHT_PLUGIN_ID, FLIGHT_PANEL_ID } from './manifest.ts'
export { coreFlight } from './manifest.ts'
