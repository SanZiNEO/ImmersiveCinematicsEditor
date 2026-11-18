/**
 * 资源列举端口（09-03 / 09-05）。
 *
 * 复用既有 WebUI 消息 `resource.list`（模组 `editor/shared/ResourceFileService`），
 * 不新增消息类型或字段；编辑器只把回执归一成素材控件可消费的列表。
 */
import type { ResourceKind, ResourceListResult } from '../../features/overlay/media.ts'

/** 资源服务：按类别列举 `resource/` 下的文件 / 语言条目。 */
export interface ResourceServicePort {
  /**
   * 列举资源；`kind=image|video|lang`。
   *
   * 失败（未连接 / 回执非法）reject，文案由实现给出，调用方显示「资源列表不可用」。
   */
  list(kind: ResourceKind, dir?: string): Promise<ResourceListResult>
}

/** 10 的媒体抽屉/字段额外需要：音频与全量、registry。不读资源文件原文。 */
export interface MediaResourceServicePort extends ResourceServicePort {
  list(kind: ResourceKind | 'audio' | 'all', dir?: string): Promise<ResourceListResult>
  queryRegistry?(kind: string, query: string, limit?: number): Promise<string[]>
}
