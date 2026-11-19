/**
 * 字幕字节解码（12-12）。
 *
 * 口径与 `electron/main.cjs` 的 `decodeSubtitleBytes` 一致：
 * - BOM 优先：UTF-8（EF BB BF）/ UTF-16LE（FF FE）/ UTF-16BE（FE FF）；
 * - 无标记先按严格 UTF-8（fatal）；严格解码失败不猜编码，返回 `needs-encoding`；
 * - 作者显式选择 `utf-8` / `gb18030` 后仍失败返回 `decode-failed`。
 *
 * 本模块是纯函数（浏览器 / Node 自检共用）；主进程 IPC 在 main.cjs 内按同一规则实现。
 */

/** 解码出的编码标签。 */
export type DecodeEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030'

/** 解码成功。 */
export interface DecodeOk {
  ok: true
  text: string
  encoding: DecodeEncoding
}

/** 解码失败（需要作者选编码 / 仍失败）。 */
export interface DecodeFail {
  ok: false
  reason: 'needs-encoding' | 'decode-failed'
}

export type DecodeResult = DecodeOk | DecodeFail

const UTF8_BOM = [0xef, 0xbb, 0xbf]
const UTF16_LE_BOM = [0xff, 0xfe]
const UTF16_BE_BOM = [0xfe, 0xff]

function hasBom(bytes: Uint8Array, bom: readonly number[]): boolean {
  if (bytes.length < bom.length) return false
  return bom.every((value, index) => bytes[index] === value)
}

function decodeFatal(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * 解码字幕字节。
 *
 * @param bytes 原始字节（未剥 BOM）。
 * @param forcedEncoding 作者显式选择；缺省 = BOM 探测 + 严格 UTF-8。
 */
export function decodeSubtitleBytes(
  bytes: Uint8Array,
  forcedEncoding?: 'utf-8' | 'gb18030',
): DecodeResult {
  if (hasBom(bytes, UTF8_BOM)) {
    const text = decodeFatal(bytes.subarray(3), 'utf-8')
    if (text !== null) return { ok: true, text, encoding: 'utf-8' }
    return { ok: false, reason: forcedEncoding === undefined ? 'needs-encoding' : 'decode-failed' }
  }
  if (hasBom(bytes, UTF16_LE_BOM)) {
    const text = decodeFatal(bytes.subarray(2), 'utf-16le')
    if (text !== null) return { ok: true, text, encoding: 'utf-16le' }
    return { ok: false, reason: 'decode-failed' }
  }
  if (hasBom(bytes, UTF16_BE_BOM)) {
    const text = decodeFatal(bytes.subarray(2), 'utf-16be')
    if (text !== null) return { ok: true, text, encoding: 'utf-16be' }
    return { ok: false, reason: 'decode-failed' }
  }
  const encoding = forcedEncoding === 'gb18030' ? 'gb18030' : 'utf-8'
  const text = decodeFatal(bytes, encoding)
  if (text !== null) return { ok: true, text, encoding }
  return { ok: false, reason: forcedEncoding === undefined ? 'needs-encoding' : 'decode-failed' }
}
