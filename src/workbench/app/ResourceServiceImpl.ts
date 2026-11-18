/**
 * WebUI 资源服务实现（10 轮接线）。
 *
 * - `resource.list`：09 已定义的 `ResourceServicePort`（图片/视频/语言/all）；
 *   本实现同时接受 `audio`（Java `ResourceFileService` 支持，09 的 UI 类型未包含）。
 * - `registry.query`：声音 id 查询（`RegistryService`，既有消息）。
 *
 * 不新增消息类型；不读取资源文件内容（10-07/10-08 边界）；所有失败都转成可显示的错误，
 * 不返回假数据。
 */
import type { JsonValue } from '../../core/doc/types.ts'
import type { MediaResourceServicePort, ResourceServicePort } from '../api/resources.ts'
import {
  parseResourceList,
  type ResourceFileList,
  type ResourceListResult,
  type ResourceKind,
} from '../../features/overlay/media.ts'
import type { WebUiClient } from '../host/webui/WebUiClient.ts'

/** 09 类型之外的 audio / all（服务端支持）。 */
export type ExtendedResourceKind = ResourceKind | 'audio' | 'all'

/** 10 轮扩展端口：在 09 的 `ResourceServicePort` 上追加只读查询。 */
export interface MediaResourceExtras {
  queryRegistry(kind: string, query: string, limit?: number): Promise<string[]>
  available(): boolean
  unavailableReason(): string
}

export interface ResourceServiceImplOptions {
  client: WebUiClient
}

export class ResourceServiceImpl implements ResourceServicePort, MediaResourceServicePort, MediaResourceExtras {
  private readonly client: WebUiClient

  constructor(options: ResourceServiceImplOptions) {
    this.client = options.client
  }

  available(): boolean {
    return this.client.connected()
  }

  unavailableReason(): string {
    return '游戏未运行或 WebUI 未连接：资源清单不可用（不据此判定文件缺失）。'
  }

  async list(kind: ExtendedResourceKind, dir?: string): Promise<ResourceListResult> {
    if (!this.client.connected()) {
      throw new Error(this.unavailableReason())
    }
    const raw = await this.client.request<JsonValue>('resource.list', {
      kind,
      dir: dir ?? '',
    })
    const parsed = parseResourceList(raw, kind as ResourceKind)
    if (parsed === null) {
      throw new Error(`resource.list 回执形状不符（kind=${kind}）`)
    }
    return parsed
  }

  /** 列出 audio（09 的联合类型未包含；服务端支持）。 */
  async listAudio(dir?: string): Promise<ResourceFileList> {
    const result = await this.list('audio', dir)
    if (result.kind === 'lang' || !('files' in result)) {
      throw new Error('resource.list 返回了语言形态，预期文件列表')
    }
    return result
  }

  async queryRegistry(kind: string, query: string, limit = 60): Promise<string[]> {
    if (!this.client.connected()) {
      throw new Error(this.unavailableReason())
    }
    const raw = await this.client.request<JsonValue>('registry.query', { kind, query, limit })
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('registry.query 回执不是对象')
    }
    const matches = (raw as Record<string, JsonValue>).matches
    if (!Array.isArray(matches)) {
      throw new Error('registry.query 回执缺少 matches')
    }
    return matches.filter((item): item is string => typeof item === 'string')
  }
}
