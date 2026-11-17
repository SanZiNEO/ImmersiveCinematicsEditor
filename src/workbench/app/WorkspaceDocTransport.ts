/**
 * 工作区文档传输（03-07）：文件 IO 走工作区，播放/预览走模组。
 *
 * 分工（与 `plan/README.md` 原则 2 一致）：
 * - `load` / `loadRaw` / `save` / `newScript` / `exists` → 直接读写
 *   `<游戏根目录>/immersive_cinematics/scripts/`；
 * - `pushScript` / `seek` / `validate` → 转给模组通道（游戏没运行就明确失败，不假装成功）。
 *
 * 这样「编辑器是固定格式脚本生成器」成立：文件的读写不需要游戏参与，
 * 只有「把脚本推给游戏播放」「看游戏产生的画面」才需要模组。
 */
import type { DocTransport } from '../../core/doc/io.ts'
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import type { ServerValidateResult, ValidationTransport } from '../../core/doc/validate.ts'
import type { WorkspacePort } from '../api/host.ts'

/** 预览/播放侧能力（游戏通道）；缺省时按「游戏未运行」处理。 */
export interface WorkspacePreviewBridge {
  pushScript(script: string): Promise<{ ok: boolean; reason?: string }>
  seek(time: number): Promise<void>
  validate(doc: JsonObject): Promise<ServerValidateResult>
  /** 游戏通道是否可用；缺省视为不可用。 */
  connected?(): boolean
}

export interface WorkspaceDocTransportOptions {
  workspace: WorkspacePort
  /** 预览通道；`null` = 纯离线（只看文件，不推预览）。 */
  preview?: WorkspacePreviewBridge | null
}

/** 未连游戏时的固定原因（不伪造成功）。 */
const NO_PREVIEW = '游戏未运行：脚本已保存到工作区，但无法推送预览'

export class WorkspaceDocTransport implements DocTransport, ValidationTransport {
  private readonly workspace: WorkspacePort
  private readonly preview: WorkspacePreviewBridge | null

  constructor(options: WorkspaceDocTransportOptions) {
    this.workspace = options.workspace
    this.preview = options.preview ?? null
  }

  /** 文件侧始终可用；预览侧取决于游戏是否运行。 */
  connected(): boolean {
    return true
  }

  /** 预览通道是否可用（供状态区显示，不影响文件读写）。 */
  previewConnected(): boolean {
    return this.preview?.connected?.() ?? this.preview !== null
  }

  async load(path: string): Promise<{ path: string; doc: JsonValue }> {
    const read = await this.workspace.readScript(path)
    if (read === null) {
      throw new Error(`脚本不存在：${path}`)
    }
    let doc: JsonValue
    try {
      doc = JSON.parse(read.text) as JsonValue
    } catch (error) {
      throw new Error(`脚本 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
    return { path, doc }
  }

  /** 读原文（冲突指纹用）：直接给文件字节，不经 JSON 往返。 */
  async loadRaw(path: string): Promise<string> {
    const read = await this.workspace.readScript(path)
    if (read === null) {
      throw new Error(`脚本不存在：${path}`)
    }
    return read.text
  }

  async save(path: string, doc: JsonObject): Promise<{ path: string }> {
    await this.workspace.writeScript(path, `${JSON.stringify(doc, null, 2)}\n`)
    return { path }
  }

  async exists(path: string): Promise<boolean> {
    return this.workspace.scriptExists(path)
  }

  /** 新建：在工作区挑唯一文件名（不覆盖已有文件）。 */
  async newScript(): Promise<{ path: string; doc: JsonValue }> {
    // 新建本身不落盘（03-07：新建即脏，首次保存才写），但必须确认工作区可用：
    // 没有工作区就没有可用的路径，此时明确失败比给一个写不进去的路径更诚实。
    const root = await this.workspace.root()
    if (root === null) {
      throw new Error('工作区未设置：请先选择游戏目录（immersive_cinematics）')
    }
    const path = await this.nextUntitledPath()
    return { path, doc: emptyScriptDoc() }
  }

  async validate(doc: JsonObject): Promise<ServerValidateResult> {
    if (this.preview === null) {
      // 离线：不做服务端语义校验，也不假装通过。
      return { ok: true, issues: [] }
    }
    return this.preview.validate(doc)
  }

  async pushScript(script: string): Promise<{ ok: boolean; reason?: string }> {
    if (this.preview === null) {
      return { ok: false, reason: NO_PREVIEW }
    }
    return this.preview.pushScript(script)
  }

  async seek(time: number): Promise<void> {
    if (this.preview === null) {
      return
    }
    await this.preview.seek(time)
  }

  /** `untitled-1.json`、`untitled-2.json`…（跳过已存在的文件）。 */
  private async nextUntitledPath(): Promise<string> {
    for (let index = 1; index <= 10_000; index += 1) {
      const candidate = `untitled-${index}.json`
      if (!await this.workspace.scriptExists(candidate)) {
        return candidate
      }
    }
    throw new Error('无法生成唯一的新脚本名（已尝试 10000 个）')
  }
}

/** 空脚本骨架：只有 meta 与 timeline.tracks，字段默认值由 03 的 store 补齐。 */
function emptyScriptDoc(): JsonValue {
  return {
    meta: { id: '', name: '', author: '', description: '' },
    timeline: { tracks: [] },
  } as unknown as JsonValue
}
