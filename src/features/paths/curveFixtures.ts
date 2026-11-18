/**
 * 07-10 golden fixture 对照：读取冻结的 `path-golden-07.json`，用编辑器 core 采样器逐点对拍。
 *
 * 期望值来源（冻结文件 description，2026-11-18，common 0.3.6 jar）：
 * 由模组已编译类 `PathCurveRegistry.create` + `PathSpec.bind(...).position(u)` 真实采样捕获后冻结，
 * 只读；**不是**编辑器采样器 `sampleGeometry` 自生成的数。本模块只做对照，不另造期望值、不改写 fixture。
 *
 * 容差按类型：arc / ellipse / bezier / rational_bezier / bspline / nurbs / catmull_rom /
 * hermite / fourier / linear = 1e-9；clothoid 走 Fresnel 数值积分，放宽到 1e-4。
 */
import type { JsonObject } from '../../core/doc/types.ts'
import { buildGeometry } from '../../core/paths/sampling.ts'
import golden from '../../workbench/fixtures/path-golden-07.json' with { type: 'json' }

export interface FixtureResult {
  type: string
  u: number
  pass: boolean
  expected: [number, number, number]
  actual: [number, number, number]
}

interface GoldenSample {
  u: number
  expected: [number, number, number]
}

interface GoldenCase {
  type: string
  from: [number, number, number]
  to: [number, number, number]
  u: number
  expected: [number, number, number]
  geometry: JsonObject
  samples?: GoldenSample[]
}

/** 按类型取容差。 */
export function fixtureTolerance(type: string): number {
  if (type === 'clothoid') {
    return 1e-4
  }
  return 1e-9
}

function near(actual: number, expected: number, epsilon: number): boolean {
  return Math.abs(actual - expected) <= epsilon
}

function tuple(point: { x: number; y: number; z: number }): [number, number, number] {
  return [point.x, point.y, point.z]
}

/** 逐条对拍冻结 fixture；返回每个采样点的对照结果（含顶层点与 samples 数组）。 */
export function checkCurveFixtures(): FixtureResult[] {
  const results: FixtureResult[] = []
  const cases = (golden as unknown as { cases: GoldenCase[] }).cases

  for (const goldenCase of cases) {
    const epsilon = fixtureTolerance(goldenCase.type)
    const evaluation = buildGeometry(
      goldenCase.geometry,
      { x: goldenCase.from[0], y: goldenCase.from[1], z: goldenCase.from[2] },
      { x: goldenCase.to[0], y: goldenCase.to[1], z: goldenCase.to[2] },
    )

    const checkPoint = (u: number, expected: [number, number, number]): void => {
      const actual = evaluation.position(u)
      const pass = near(actual.x, expected[0], epsilon)
        && near(actual.y, expected[1], epsilon)
        && near(actual.z, expected[2], epsilon)
      results.push({ type: goldenCase.type, u, pass, expected, actual: tuple(actual) })
    }

    checkPoint(goldenCase.u, goldenCase.expected)

    for (const sample of goldenCase.samples ?? []) {
      const sampled = evaluation.position(sample.u)
      const pass = near(sampled.x, sample.expected[0], epsilon)
        && near(sampled.y, sample.expected[1], epsilon)
        && near(sampled.z, sample.expected[2], epsilon)
      results.push({ type: goldenCase.type, u: sample.u, pass, expected: sample.expected, actual: tuple(sampled) })
    }
  }

  return results
}

/** 汇总：通过 / 失败条数与失败类型。 */
export function fixtureSummary(results: FixtureResult[]): { ok: number; fail: number; failedTypes: string[] } {
  const failedTypes = [...new Set(results.filter((result) => !result.pass).map((result) => result.type))]
  return {
    ok: results.filter((result) => result.pass).length,
    fail: results.filter((result) => !result.pass).length,
    failedTypes,
  }
}
