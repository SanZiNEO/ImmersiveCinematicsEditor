/**
 * 配置加载与严格校验（docs/13-e2e-system.md §3）。
 *
 * 未知模板 / 未引用场景 / 未解析参数都在加载期报错，给出文件路径与原因；
 * 缺能力属于运行期 BLOCKED（registry 探测），不在此伪造通过。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expandValue, ExpandError } from './template.ts'

export class ConfigError extends Error {
  readonly code: 'E_CONFIG' | 'E_EXPAND'
  constructor(code: 'E_CONFIG' | 'E_EXPAND', message: string) {
    super(message)
    this.name = 'ConfigError'
    this.code = code
  }
}

export interface ResolvedConfig {
  artifactsDir: string
  defaultTimeoutMs: number
  launchTimeoutMs: number
  ports: { vite: number; webui: number }
  paths: { editorRepo: string; workspace: string; icdev: string }
  env: { webuiTokenFile: string }
}

export interface TemplateStep {
  op: string
  with: Record<string, unknown>
  expect: Record<string, unknown>
}

export interface TemplateDef {
  id: string
  description: string
  requires: string[]
  steps: TemplateStep[]
}

export interface ScenarioDef {
  id: string
  title: string
  template: string
  params: Record<string, unknown>
  covers: string[]
}

export interface SuiteDef {
  id: string
  title: string
  plugins: string[]
  scenarios: string[]
}

export interface ExpandedStep {
  op: string
  with: Record<string, unknown>
  expect: Record<string, unknown>
}

export interface LoadedScenario {
  def: ScenarioDef
  template: TemplateDef
  requires: string[]
  steps: ExpandedStep[]
}

function readJson(file: string): unknown {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    throw new ConfigError('E_CONFIG', `读取配置失败 ${file}: ${String(error)}`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new ConfigError('E_CONFIG', `JSON 解析失败 ${file}: ${String(error)}`)
  }
}

function asObject(value: unknown, file: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError('E_CONFIG', `配置不是对象: ${file}`)
  }
  return value as Record<string, unknown>
}

function expandEnvVar(raw: string): string {
  return raw.replace(/%USERPROFILE%/g, process.env.USERPROFILE ?? '')
}

export class ConfigLoader {
  readonly repoRoot: string
  readonly e2eRoot: string
  private readonly templates = new Map<string, TemplateDef>()
  private readonly scenarios = new Map<string, ScenarioDef>()
  private readonly suites = new Map<string, SuiteDef>()
  readonly resolved: ResolvedConfig

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot
    this.e2eRoot = path.join(repoRoot, 'e2e-system')
    const defaultFile = path.join(this.e2eRoot, 'config', 'default.json')
    const raw = asObject(readJson(defaultFile), defaultFile)

    const paths = asObject(raw.paths ?? {}, defaultFile)
    const ports = asObject(raw.ports ?? {}, defaultFile)
    const env = asObject(raw.env ?? {}, defaultFile)

    const workspace = process.env.IC_WORKSPACE
      ?? path.resolve(repoRoot, String(paths.workspace ?? '../ImmersiveCinematics/fabric/run/immersive_cinematics'))
    const icdev = process.env.ICDEV_HOME
      ?? path.resolve(repoRoot, String(paths.icdev ?? '../ImmersiveCinematics/tools/devtools'))
    const tokenFile = process.env.IC_WEBUI_TOKEN_FILE
      ?? expandEnvVar(String(env.webuiTokenFile ?? ''))

    this.resolved = {
      artifactsDir: path.resolve(repoRoot, String(raw.artifactsDir ?? 'e2e-system/artifacts')),
      defaultTimeoutMs: Number(raw.defaultTimeoutMs ?? 20000),
      launchTimeoutMs: Number(raw.launchTimeoutMs ?? 90000),
      ports: {
        vite: Number(ports.vite ?? 5173),
        webui: Number(ports.webui ?? 8765),
      },
      paths: {
        editorRepo: repoRoot,
        workspace,
        icdev,
      },
      env: { webuiTokenFile: tokenFile },
    }

    this.loadTemplates()
    this.loadScenarios()
    this.loadSuites()
  }

  private loadTemplates(): void {
    const dir = path.join(this.e2eRoot, 'config', 'templates')
    for (const file of this.listDir(dir)) {
      const full = path.join(dir, file)
      const obj = asObject(readJson(full), full)
      const stepsRaw = Array.isArray(obj.steps) ? obj.steps : []
      const steps: TemplateStep[] = stepsRaw.map((entry, index) => {
        const step = asObject(entry, `${full}#${index}`)
        return {
          op: String(step.op ?? ''),
          with: (step.with ?? {}) as Record<string, unknown>,
          expect: (step.expect ?? {}) as Record<string, unknown>,
        }
      })
      const def: TemplateDef = {
        id: String(obj.id ?? ''),
        description: String(obj.description ?? ''),
        requires: Array.isArray(obj.requires) ? obj.requires.map(String) : [],
        steps,
      }
      if (def.id === '') throw new ConfigError('E_CONFIG', `模板缺少 id: ${full}`)
      this.templates.set(def.id, def)
    }
  }

  private loadScenarios(): void {
    const dir = path.join(this.e2eRoot, 'config', 'scenarios')
    for (const file of this.listDir(dir)) {
      const full = path.join(dir, file)
      const obj = asObject(readJson(full), full)
      const def: ScenarioDef = {
        id: String(obj.id ?? ''),
        title: String(obj.title ?? ''),
        template: String(obj.template ?? ''),
        params: (obj.params ?? {}) as Record<string, unknown>,
        covers: Array.isArray(obj.covers) ? obj.covers.map(String) : [],
      }
      if (def.id === '') throw new ConfigError('E_CONFIG', `场景缺少 id: ${full}`)
      if (!this.templates.has(def.template)) {
        throw new ConfigError('E_CONFIG', `场景 ${def.id} 引用未知模板 "${def.template}": ${full}`)
      }
      this.scenarios.set(def.id, def)
    }
  }

  private loadSuites(): void {
    const dir = path.join(this.e2eRoot, 'config', 'suites')
    for (const file of this.listDir(dir)) {
      const full = path.join(dir, file)
      const obj = asObject(readJson(full), full)
      const def: SuiteDef = {
        id: String(obj.id ?? ''),
        title: String(obj.title ?? ''),
        plugins: Array.isArray(obj.plugins) ? obj.plugins.map(String) : [],
        scenarios: Array.isArray(obj.scenarios) ? obj.scenarios.map(String) : [],
      }
      for (const scenarioId of def.scenarios) {
        if (!this.scenarios.has(scenarioId)) {
          throw new ConfigError('E_CONFIG', `套件 ${def.id} 引用未知场景 "${scenarioId}": ${full}`)
        }
      }
      this.suites.set(def.id, def)
    }
  }

  private listDir(dir: string): string[] {
    if (!existsSync(dir)) return []
    return readdirSafe(dir).filter((name) => name.endsWith('.json'))
  }

  get suiteIds(): string[] {
    return [...this.suites.keys()]
  }

  get templateIds(): string[] {
    return [...this.templates.keys()]
  }

  get scenarioIds(): string[] {
    return [...this.scenarios.keys()]
  }

  suite(id: string): SuiteDef {
    const found = this.suites.get(id)
    if (found === undefined) throw new ConfigError('E_CONFIG', `未知套件 "${id}"；可用: ${this.suiteIds.join(', ')}`)
    return found
  }

  template(id: string): TemplateDef {
    const found = this.templates.get(id)
    if (found === undefined) throw new ConfigError('E_CONFIG', `未知模板 "${id}"`)
    return found
  }

  /** 展开一个场景：模板 + 参数 → 具体步骤；未解析参数抛 E_EXPAND。 */
  resolveScenario(scenarioId: string): LoadedScenario {
    const def = this.scenarios.get(scenarioId)
    if (def === undefined) throw new ConfigError('E_CONFIG', `未知场景 "${scenarioId}"`)
    const template = this.template(def.template)
    const steps: ExpandedStep[] = template.steps.map((step, index) => {
      const label = `场景 ${def.id} 步骤 ${index + 1}`
      let expandedWith: Record<string, unknown>
      let expandedExpect: Record<string, unknown>
      try {
        expandedWith = expandValue(step.with, def.params, `${label} with`) as Record<string, unknown>
        expandedExpect = expandValue(step.expect, def.params, `${label} expect`) as Record<string, unknown>
      } catch (error) {
        if (error instanceof ExpandError) throw new ConfigError('E_EXPAND', error.message)
        throw error
      }
      return { op: step.op, with: expandedWith, expect: expandedExpect }
    })
    return { def, template, requires: template.requires, steps }
  }

  resolveSuite(suiteId: string, scenarioId?: string): { suite: SuiteDef; scenarios: LoadedScenario[] } {
    const suite = this.suite(suiteId)
    const ids = scenarioId === undefined ? suite.scenarios : [scenarioId]
    if (scenarioId !== undefined && !suite.scenarios.includes(scenarioId)) {
      throw new ConfigError('E_CONFIG', `场景 "${scenarioId}" 不属于套件 "${suiteId}"`)
    }
    const scenarios = ids.map((id) => this.resolveScenario(id))
    return { suite, scenarios }
  }

  manualItems(): Array<{ id: string; source: string; title: string; reason: string }> {
    const file = path.join(this.e2eRoot, 'config', 'manual-items.json')
    const obj = asObject(readJson(file), file)
    const items = Array.isArray(obj.items) ? obj.items : []
    return items.map((entry) => {
      const row = asObject(entry, file)
      return {
        id: String(row.id ?? ''),
        source: String(row.source ?? ''),
        title: String(row.title ?? ''),
        reason: String(row.reason ?? ''),
      }
    })
  }
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function repoRootFromUrl(metaUrl: string): string {
  const here = path.dirname(fileURLToPath(metaUrl))
  return path.resolve(here, '..', '..')
}
