/**
 * evidence 插件（docs/13-e2e-system.md §4.1）。
 *
 * 能力：evidence。登记截图、夹具、日志、哈希等证据；文件只记录真实路径与
 * sha256，不复制、不伪造回执。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { E2ePlugin, PluginContext, StepResult } from '../../src/registry.ts'

function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function createEvidencePlugin(): E2ePlugin {
  return {
    id: 'evidence',
    capabilities: ['evidence'],
    ops: ['evidence.note', 'evidence.file', 'evidence.attach', 'evidence.hash'],

    async available(ctx: PluginContext) {
      const missing: string[] = []
      try {
        mkdirSync(ctx.artifactsDir, { recursive: true })
      } catch (error) {
        missing.push(`证据目录不可写: ${ctx.artifactsDir} (${String(error)})`)
      }
      return { ok: missing.length === 0, missing }
    },

    async invoke(ctx, op, params): Promise<StepResult> {
      switch (op) {
        case 'evidence.note': {
          const note = String(params.note ?? '')
          ctx.attachEvidence({ kind: 'note', path: '', note })
          ctx.log(`[evidence] ${note}`)
          return { ok: true, summary: `记录备注: ${note}` }
        }

        case 'evidence.file': {
          const file = String(params.path ?? '')
          if (!existsSync(file)) {
            return { ok: false, reason: `证据文件不存在: ${file}`, expected: '文件存在', actual: '缺失' }
          }
          const hash = sha256Bytes(readFileSync(file))
          ctx.attachEvidence({ kind: 'file', path: file, note: String(params.note ?? path.basename(file)), hash })
          return { ok: true, value: { path: file, hash }, summary: `登记证据 ${path.basename(file)} (sha256 ${hash.slice(0, 12)}…)` }
        }

        case 'evidence.attach': {
          const file = String(params.path ?? '')
          ctx.attachEvidence({ kind: 'attachment', path: file, note: String(params.note ?? '') })
          return { ok: true, summary: `挂载证据 ${file}` }
        }

        case 'evidence.hash': {
          const bytes = Buffer.from((params.bytes ?? []) as number[])
          const hash = sha256Bytes(bytes)
          return { ok: true, value: { hash }, summary: `sha256 ${hash.slice(0, 12)}…` }
        }

        default:
          return { ok: false, reason: `evidence 未实现 op: ${op}` }
      }
    },
  }
}
