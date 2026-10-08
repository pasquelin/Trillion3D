// The header's position error moved onto packages/math: `distanceVector3` for the distance and
// `ceilFloat32` for the rounding up. The real `positionError` is held here to the body it replaced,
// written below as the oracle, over a Halton sweep of grids and vertices and its edges.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FLOAT32_MAX } from '../../math/src/constants.ts'
import { ceilFloat32 } from '../../math/src/float/splitDouble.ts'
import { halton } from '../../math/src/sequence/halton.ts'
import { positionError } from './geometryPage.ts'
import type { QuantizedGrid } from './pageGrids.ts'

const N = 4096

/** The rounding up `geometryPage.ts` carried: one step up the float32 bits, whatever the sign. */
function ceil32(value: number): number {
  const float = new Float32Array([value])
  if (float[0] < value) new Uint32Array(float.buffer)[0]++
  return float[0]
}

/** The former body of `positionError`, word for word: per vertex the squares by `** 2` from 0,
 *  the root, the largest kept, rounded up. */
function oldPositionError(grid: QuantizedGrid, sources: number[], original: number[]) {
  const step = 2 ** grid.exponent
  let error = 0
  original.forEach((_, i) => {
    let d = 0
    for (let c = 0; c < 3; c++)
      d +=
        (Math.fround(grid.min[c] + Math.fround(grid.cells[i * 3 + c] * step)) -
          sources[original[i] * 3 + c]) **
        2
    error = Math.max(error, Math.sqrt(d))
  })
  return ceil32(error)
}

/** A grid and its vertices: `cells[v]` quantizes the source at `original[v]`. */
type Case = [min: number[], exponent: number, cells: number[][], sources: number[][]]

/** `positionError` of a case, the vertices read through the permutation `original`. */
function errors([min, exponent, cells, sources]: Case) {
  const original = sources.map((_, v) => (v * 3 + 1) % sources.length)
  const grid = { min, exponent, bits: [24, 24, 24], cells: original.flatMap((o) => cells[o]) }
  const array = sources.flat()
  return [
    positionError(grid, { itemSize: 3, array }, original),
    oldPositionError(grid, array, original),
  ]
}

test('the position error is the former one, to the float32, on every swept grid', () => {
  const cases: Case[] = [
    [[0, 0, 0], 0, [[0, 0, 0]], [[0, 0, 0]]],
    [[-0, 0, -0], -10, [[0, 0, 0]], [[-0, -0, 0]]],
    [[1, 0, 0], 0, [[0, 0, 0]], [[0, 0, 0]]],
    [[-1.5, 2, 0.25], -20, [[3, 0, 2 ** 23]], [[-1.5, 2.000001, 8.25]]],
    [[Math.fround(1e30), 0, 0], 0, [[0, 0, 0]], [[-1e30, 0, 0]]],
    [[0, 0, 0], -149, [[1, 1, 1]], [[0, 0, 0]]],
  ]
  for (let i = 1; i <= N; i++) {
    const exponent = Math.floor(halton(i, 7) * 40) - 30,
      step = 2 ** exponent,
      scale = 2 ** Math.floor(halton(i, 5) * 20 - 5)
    const min = [2, 3, 5].map((b) => Math.fround((halton(i, b) - 0.5) * scale))
    const cells: number[][] = [],
      sources: number[][] = []
    for (let v = 0; v < 4; v++) {
      const at = 4 * i + v
      const cell = [3, 5, 7].map((b) => Math.floor(halton(at, b) * 2 ** 24))
      cells.push(cell)
      sources.push(min.map((m, c) => m + cell[c] * step + (halton(at, 2 + c) - 0.5) * step))
    }
    cases.push([min, exponent, cells, sources])
  }
  for (const c of cases) {
    const [error, before] = errors(c)
    assert.ok(Object.is(error, before), `${JSON.stringify(c)}: ${error} ${before}`)
  }
})

test('a source closer than the plain sum can square is bounded, not reported exact', () => {
  // The Rust twin (`quantization_error`) and the decoded pages read float32 sources, whose gaps
  // are multiples of 2^-149 and square within the rule's band. A double source 1e-170 from its
  // cell squared to 0 in the former body; the rule's root bounds it by the least float32.
  const [error, before] = errors([[0, 0, 0], 0, [[0, 0, 0]], [[1e-170, 0, 0]]])
  assert.ok(Object.is(before, 0) && Object.is(error, 2 ** -149), `${error} ${before}`)
})

test('ceilFloat32 is the old rounding up on every input the position error gives it', () => {
  // `positionError` starts at +0 and keeps `Math.max(error, root)`, a root of a sum of squares
  // from +0: its value is +0, positive, +Infinity or NaN, never negative. On those `ceilFloat32`
  // steps the bits up as `ceil32` did; below zero they differ (`ceil32` stepped away from zero).
  const inputs = [0, -0, 2 ** -149, 1e-46, 3 * 2 ** -150, 1, 1 + 2 ** -30, 1 - 2 ** -30]
  inputs.push(FLOAT32_MAX, FLOAT32_MAX * (1 + 2 ** -25), 3.5e38, Infinity, NaN)
  for (let i = 1; i <= N; i++) inputs.push(halton(i, 2) * 2 ** (halton(i, 3) * 300 - 160))
  for (const value of inputs) assert.ok(Object.is(ceil32(value), ceilFloat32(value)), `${value}`)
  const negative = -(1 + 2 ** -24 + 2 ** -30)
  assert.ok(ceil32(negative) < negative && ceilFloat32(negative) >= negative, 'negatives differ')
})
