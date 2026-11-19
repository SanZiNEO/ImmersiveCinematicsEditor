/** run.json 落盘（docs/13-e2e-system.md §7）。 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import type { RunReport } from '../runner.ts'

export function writeRunJson(report: RunReport, artifactsDir: string): string {
  const file = path.join(artifactsDir, 'run.json')
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8')
  return file
}
