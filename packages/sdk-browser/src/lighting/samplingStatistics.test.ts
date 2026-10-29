// The cone and spherical-rectangle samplers of the shared WGSL library, run in JavaScript from the shipped text: each must draw
// evenly in the solid angle it reports, which a statistical test over a stratified grid of random numbers shows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { coneSolidAngle, sampleConeLocal } from '../../../math/src/wgsl/coneSampling.ts'
import { buildSphericalRect, sampleSphericalRect } from '../../../math/src/wgsl/sphericalRect.ts'

type Run = Record<string, (...args: never[]) => unknown>
const GRID = 96
/** The centres of a stratified grid of random numbers of the unit square. */
const grid = (): number[][] => {
  const out: number[][] = []
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++) out.push([(i + 0.5) / GRID, (j + 0.5) / GRID])
  return out
}

test('a direction drawn in a cone by the concentric map is evenly spread in its solid angle', () => {
  const { sampleConeLocal: sample, coneSolidAngle: solid } = shaderRun<
    {
      sampleConeLocal: (e: number[], sin2: number, concentric: boolean) => number[]
      coneSolidAngle: (sin2: number) => number
    } & Run
  >(
    wgslBlock('CONE_STATISTICS', [coneSolidAngle, sampleConeLocal], ''),
    ['coneSolidAngle', 'sampleConeLocal'],
    {},
  )
  for (const angle of [0.05, 0.4, 1.2]) {
    const sin2 = Math.sin(angle) ** 2
    const cosMax = Math.cos(angle)
    let above = 0
    let mean = 0
    const points = grid()
    for (const e of points) {
      const [x, y, z, pdf] = sample(e, sin2, true) as [number, number, number, number]
      assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-5, 'unit direction')
      assert.ok(z >= cosMax - 1e-5, 'inside the cone')
      assert.ok(Math.abs(pdf * solid(sin2) - 1) < 1e-5, 'density of the solid angle')
      mean += z
      if (z > (1 + cosMax) / 2) above++
    }
    // Even in the solid angle: the height along the axis is even on [cos, 1], half the draws above its middle.
    assert.ok(
      Math.abs(mean / points.length - (1 + cosMax) / 2) < 2e-3,
      `mean height, angle ${angle}`,
    )
    assert.ok(Math.abs(above / points.length - 0.5) < 0.01, `half above the middle, angle ${angle}`)
  }
})

test('a point drawn on a spherical rectangle is evenly spread in the solid angle it covers', () => {
  const run = shaderRun<
    {
      buildSphericalRect: (...a: unknown[]) => { solid: number }
      sampleSphericalRect: (
        e: number[],
        rect: unknown,
      ) => { direction: number[]; distance: number; invPdf: number }
    } & Run
  >(
    wgslBlock('RECT_STATISTICS', [buildSphericalRect, sampleSphericalRect], ''),
    ['buildSphericalRect', 'sampleSphericalRect'],
    {},
  )
  const axes = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const build = (centre: number[], half: number[]) => run.buildSphericalRect(centre, ...axes, half)
  for (const [centre, half] of [
    [
      [0.3, 0.2, -1.5],
      [1, 0.7],
    ],
    [
      [-2, 1, 0.8],
      [0.5, 1.5],
    ],
  ] as const) {
    const rect = build([...centre], [...half])
    // The solid angle of the rectangle against a midpoint sum of cos/d^2 over its area.
    let integral = 0
    const n = 400
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = centre[0] - half[0] + ((i + 0.5) / n) * 2 * half[0]
        const y = centre[1] - half[1] + ((j + 0.5) / n) * 2 * half[1]
        const d2 = x * x + y * y + centre[2] * centre[2]
        integral += ((Math.abs(centre[2]) / Math.sqrt(d2) / d2) * (4 * half[0] * half[1])) / (n * n)
      }
    assert.ok(
      Math.abs(rect.solid - integral) < 1e-3 * integral,
      `solid angle ${rect.solid} against ${integral}`,
    )
    // The share of the draws that land left of the rectangle's vertical middle is the share of its solid angle.
    const left = build(
      [centre[0] - half[0] / 2, centre[1], centre[2]],
      [half[0] / 2, half[1]],
    ).solid
    const lower = build(
      [centre[0], centre[1] - half[1] / 2, centre[2]],
      [half[0], half[1] / 2],
    ).solid
    let inLeft = 0
    let inLower = 0
    const points = grid()
    for (const e of points) {
      const s = run.sampleSphericalRect(e, rect)
      assert.ok(Math.abs(s.invPdf - rect.solid) < 1e-6)
      const x = s.direction[0] * s.distance
      const y = s.direction[1] * s.distance
      assert.ok(x >= centre[0] - half[0] - 1e-4 && x <= centre[0] + half[0] + 1e-4, 'inside across')
      assert.ok(y >= centre[1] - half[1] - 1e-4 && y <= centre[1] + half[1] + 1e-4, 'inside down')
      if (x < centre[0]) inLeft++
      if (y < centre[1]) inLower++
    }
    assert.ok(Math.abs(inLeft / points.length - left / rect.solid) < 0.01, `left share, ${centre}`)
    assert.ok(
      Math.abs(inLower / points.length - lower / rect.solid) < 0.01,
      `lower share, ${centre}`,
    )
  }
})
