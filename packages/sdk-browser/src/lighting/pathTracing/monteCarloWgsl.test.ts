// The sampling helpers and the random sequence of the path tracer, run in JavaScript from the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { coneSolidAngle, sampleConeLocal } from '../../../../math/src/wgsl/coneSampling.ts'
import { PT_MONTE_CARLO_WGSL } from './monteCarloWgsl.ts'
import { PT_RANDOM_WGSL } from './randomWgsl.ts'

type Run = Record<string, (...args: never[]) => unknown>
const monteCarlo = () =>
  shaderRun<
    {
      ptMisPower: (a: number, b: number) => number
      ptMisBalance: (a: number, b: number) => number
      ptRescale: (v: number, low: number, high: number) => number
    } & Run
  >(PT_MONTE_CARLO_WGSL, ['ptMisPower', 'ptMisBalance', 'ptRescale'], {})
const cone = () =>
  shaderRun<
    {
      coneSolidAngle: (sin2: number) => number
      sampleConeLocal: (e: number[], sin2: number, concentric: boolean) => number[]
    } & Run
  >(
    wgslBlock('CONE_SAMPLING_TEST', [coneSolidAngle, sampleConeLocal], ''),
    ['coneSolidAngle', 'sampleConeLocal'],
    {},
  )

test('the two weights of a pair of strategies add to one, whatever the densities (zero and infinite included)', () => {
  const { ptMisPower, ptMisBalance } = monteCarlo()
  for (const [a, b] of [
    [1, 3],
    [0.2, 40],
    [0, 5],
    [5, 0],
    [0, 0],
    [Infinity, 2],
    [2, Infinity],
    [Infinity, Infinity],
  ] as const) {
    assert.equal(ptMisPower(a, b) + ptMisPower(b, a), 1, `power ${a} ${b}`)
    assert.equal(ptMisBalance(a, b) + ptMisBalance(b, a), 1, `balance ${a} ${b}`)
  }
  assert.equal(ptMisPower(1, 1), 0.5)
  assert.ok(Math.abs(ptMisPower(2, 1) - 4 / 5) < 1e-6)
  assert.ok(Math.abs(ptMisBalance(2, 1) - 2 / 3) < 1e-6)
})

test('a cone’s solid angle is 2π(1 − cos θ), by a series where the cone is narrow', () => {
  const { coneSolidAngle: ptConeSolidAngle } = cone()
  for (const angle of [0.001, 0.05, 0.3, 1.2]) {
    const exact = 2 * Math.PI * (1 - Math.cos(angle))
    assert.ok(
      Math.abs(ptConeSolidAngle(Math.sin(angle) ** 2) - exact) <= exact * 1e-4,
      `angle ${angle}`,
    )
  }
})

test('a direction drawn in a cone lies in it and has the density of its solid angle', () => {
  const { sampleConeLocal, coneSolidAngle: ptConeSolidAngle } = cone()
  const sin2 = Math.sin(0.4) ** 2
  for (const e of [
    [0.1, 0.2],
    [0.9, 0.7],
    [0.5, 1],
    [0.3, 0],
  ]) {
    const [x, y, z, pdf] = sampleConeLocal(e, sin2, false) as [number, number, number, number]
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-6)
    assert.ok(z >= Math.cos(0.4) - 1e-6)
    assert.ok(Math.abs(pdf * ptConeSolidAngle(sin2) - 1) < 1e-5)
  }
})

test('a number of an interval is a number of [0, 1) again', () => {
  const { ptRescale } = monteCarlo()
  assert.equal(ptRescale(0.25, 0, 0.5), 0.5)
  assert.equal(ptRescale(0.75, 0.5, 1), 0.5)
  assert.ok(ptRescale(1, 0, 1) < 1)
})

test('the pixel’s place along the curve visits a block of 16 by 16 pixels in 256 consecutive numbers', () => {
  const { ptCurveIndex } = shaderRun<{ ptCurveIndex: (x: number, y: number) => number }>(
    PT_RANDOM_WGSL,
    ['ptCurveIndex'],
    {},
  )
  for (const [bx, by] of [
    [0, 0],
    [1, 0],
    [5, 9],
  ] as const) {
    const indices = new Set<number>()
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 16; y++) indices.add(ptCurveIndex(bx * 16 + x, by * 16 + y))
    const low = Math.min(...indices)
    assert.equal(indices.size, 256)
    assert.equal(Math.max(...indices) - low, 255, `block ${bx},${by}`)
    assert.equal(low % 256, 0)
  }
})

test('the camera filter is a Gaussian of the width asked: centred on the pixel, a deviation of a sixth of the width, nothing at width zero', () => {
  const { ptFilterJitter } = shaderRun<
    { ptFilterJitter: (e: number[], width: number) => number[] } & Run
  >(PT_MONTE_CARLO_WGSL, ['ptFilterJitter'], {})
  assert.deepEqual(ptFilterJitter([0.3, 0.8], 0), [0.5, 0.5])
  const n = 128
  let sum = 0
  let sumSquares = 0
  let count = 0
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const [x] = ptFilterJitter([(i + 0.5) / n, (j + 0.5) / n], 3) as [number, number]
      sum += x - 0.5
      sumSquares += (x - 0.5) ** 2
      count++
    }
  assert.ok(Math.abs(sum / count) < 0.01)
  assert.ok(Math.abs(Math.sqrt(sumSquares / count) - 0.5) < 0.05)
})
