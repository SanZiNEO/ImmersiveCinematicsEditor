/**
 * 离线快照：把一份 `FieldCatalog` 连同来源元数据写成 JSON 文件，断网时仍可回读。
 *
 * 文件只做存取，不参与目录构建；同名快照永不覆盖，依次让位到 `-2`、`-3`。
 * 只用 Node 内置模块，不引入依赖。
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FieldCatalog } from './types.ts'

/** 快照来源：缺一不可，回读时逐个校验。 */
export interface SnapshotSource {
  gameVersion: string
  modVersion: string
  capturedAt: string
  sourceCommit: string
  catalogHash: string
}

/** 快照文件内容：来源 + 完整目录。 */
export interface SnapshotFile {
  source: SnapshotSource
  catalog: FieldCatalog
}

const FILE_PREFIX = 'snapshot-'
const FILE_SUFFIX = '.json'
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/

/** `capturedAt` 前 10 位是合法日历日期时返回 `YYYYMMDD`，否则 `undefined`。 */
function dateStamp(capturedAt: string): string | undefined {
  const match = DATE_PREFIX.exec(capturedAt)
  if (match === null) {
    return undefined
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) {
    return undefined
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) {
    return undefined
  }
  return `${match[1]}${match[2]}${match[3]}`
}

/** `snapshot-<gameVersion>-<modVersion>-<YYYYMMDD>.json`；`capturedAt` 不是日期时用净化后的原字符串。 */
export function snapshotFileName(source: SnapshotSource): string {
  const stamp = dateStamp(source.capturedAt) ?? source.capturedAt.replace(/[^A-Za-z0-9]/g, '-')
  if (stamp === '') {
    throw new Error(`capturedAt 为空，无法生成快照文件名：${JSON.stringify(source.capturedAt)}`)
  }
  return `${FILE_PREFIX}${source.gameVersion}-${source.modVersion}-${stamp}${FILE_SUFFIX}`
}

/**
 * 把快照写进 `dir`（不存在则递归创建），返回实际写入的完整路径。
 *
 * 先用 `wx` 独占创建；同名已存在则依次尝试 `-2`、`-3`，绝不覆盖既有文件。
 * 文件内容为两空格缩进 JSON，末尾带换行。
 */
export async function saveSnapshot(dir: string, snapshot: SnapshotFile): Promise<string> {
  await mkdir(dir, { recursive: true })
  const baseName = snapshotFileName(snapshot.source)
  const text = `${JSON.stringify(snapshot, null, 2)}\n`
  for (let attempt = 1; ; attempt += 1) {
    const fileName = attempt === 1
      ? baseName
      : `${baseName.slice(0, -FILE_SUFFIX.length)}-${attempt}${FILE_SUFFIX}`
    const filePath = join(dir, fileName)
    try {
      await writeFile(filePath, text, { encoding: 'utf8', flag: 'wx' })
      return filePath
    } catch (error) {
      if (error === null || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') {
        throw error
      }
    }
  }
}

/** 读快照并校验 `source` / `catalog` 存在且 `source` 五个字段齐全。 */
export async function loadSnapshot(path: string): Promise<SnapshotFile> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { source?: unknown; catalog?: unknown }
  const source = parsed.source
  const catalog = parsed.catalog
  if (typeof source !== 'object' || source === null || Array.isArray(source)
    || typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) {
    throw new Error(`快照缺少 source 或 catalog：${path}`)
  }
  const fields = source as Record<string, unknown>
  const read = (key: keyof SnapshotSource): string => {
    const value = fields[key]
    if (typeof value !== 'string') {
      throw new Error(`快照 source.${key} 缺失或不是字符串：${path}`)
    }
    return value
  }
  return {
    source: {
      gameVersion: read('gameVersion'),
      modVersion: read('modVersion'),
      capturedAt: read('capturedAt'),
      sourceCommit: read('sourceCommit'),
      catalogHash: read('catalogHash'),
    },
    catalog: catalog as FieldCatalog,
  }
}

/** 目录内全部 `.json` 文件名，按名称升序；目录不存在返回空数组。 */
export async function listSnapshots(dir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
  return names.filter((name) => name.endsWith(FILE_SUFFIX)).sort()
}
