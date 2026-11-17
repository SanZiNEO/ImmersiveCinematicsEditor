/**
 * WebUI 脚本来源（05-01 的生产实现）。
 *
 * 只调用一次 `script.list` 取文件清单；每个脚本用 `script.load` 读取。
 * 没有本地目录扫描，也不维护第二套脚本表。
 */
import type { JsonValue } from '../../core/doc/types.ts'
import type { ScriptSource } from '../api/graph.ts'
import { WebUiClient } from '../host/webui/WebUiClient.ts'
import { WEBUI_MESSAGE } from '../host/webui/protocol.ts'

export class WebUiScriptSource implements ScriptSource {
  private readonly client: WebUiClient

  constructor(client: WebUiClient) {
    this.client = client
  }

  connected(): boolean {
    return this.client.connected()
  }

  async list(): Promise<string[]> {
    const result = await this.client.request<unknown>(WEBUI_MESSAGE.scriptList, {})
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new Error('script.list 回执格式错误')
    }
    if (!('files' in result) || !Array.isArray(result.files)) {
      throw new Error('script.list 回执缺少 files')
    }
    return result.files.filter((file): file is string => typeof file === 'string')
  }

  async load(path: string): Promise<JsonValue> {
    const result = await this.client.request<unknown>(WEBUI_MESSAGE.scriptLoad, { path })
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new Error('script.load 回执格式错误')
    }
    if (!('doc' in result) || result.doc === undefined) {
      throw new Error('script.load 回执缺少 doc')
    }
    return result.doc as JsonValue
  }

  async save(path: string, doc: JsonValue): Promise<void> {
    await this.client.request<unknown>(WEBUI_MESSAGE.scriptSave, { path, doc })
  }
}
