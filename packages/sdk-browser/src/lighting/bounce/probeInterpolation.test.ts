// The weights of the four uniform probes a pixel reads, run on the shipped text.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { spWeights } from './screen/probesWgsl.ts'

type Probe = { P: number[]; depth: number; N: number[]; speed: number }

/** The weights of the four uniform probes round a pixel run on the shipped text: `at` places the probe of a tile, `pixel` weighs the
 *  four round the pixel at `(x, z)` of a flat surface, one that lights its backface where `foliage`. */
function interpolationOf() {
  const probes = new Map<string, Probe>()
  const at = (tile: number[], probe: Partial<Probe> = {}) =>
    probes.set(String(tile), {
      P: [tile[0] * 16, 0, tile[1] * 16],
      depth: 10,
      N: [0, 1, 0],
      speed: 0,
      ...probe,
    })
  const { spInterpolation } = shaderRun<{
    spInterpolation: (
      pixel: number[],
      noise: number[],
      P: number[],
      N: number[],
      depth: number,
      foliage: boolean,
    ) => { w: number[]; fallback: number[]; tile: number[] }
  }>(wgslModule(spCommon([4, 2]), spWeights), ['spInterpolation'], {
    sp: {
      size: [64, 64, 16, 0],
      grid: [4, 4, 4, 0],
      mode: [0, 0, 0, 0],
      weights: [-10000, -1000, 0.1, 10],
      foliage: [0, 0, -2500, 0],
    },
    spCornerProbe: (tile: number[]) => probes.get(String(tile)),
    reverseBits: (x: number) => {
      let reversed = 0
      for (let bit = 0; bit < 32; bit++) reversed = (reversed << 1) | ((x >>> bit) & 1)
      return reversed >>> 0
    },
  })
  return {
    at,
    pixel: (x: number, z: number, foliage = false) =>
      spInterpolation([x, z], [0, 0], [x, 0, z], [0, 1, 0], 10, foliage),
    /** The same pixel read from a place moved by `noise`. */
    moved: (x: number, z: number, noise: number[]) =>
      spInterpolation([x, z], noise, [x, 0, z], [0, 1, 0], 10, false),
  }
}

test('the four probes round a pixel weigh by their place in the tile and by how near their plane the pixel lies', () => {
  const { at, pixel } = interpolationOf()
  const sum = (weights: number[]) => weights.reduce((a, b) => a + b, 0)
  for (const tile of [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ])
    at(tile)
  const flat = pixel(20, 20)
  assert.deepEqual(flat.tile, [1, 1], 'the tile of the pixel')
  assert.ok(Math.abs(sum(flat.w) - 1) < 1e-6, `a flat surface: the weights sum to one, ${flat.w}`)
  assert.ok(
    flat.w[0] > flat.w[1] && flat.w[0] > flat.w[2] && flat.w[0] > flat.w[3],
    'the nearest corner weighs most',
  )
  // A probe off the pixel's plane weighs nothing, the others share what the bilinear gives them.
  at([2, 2], { P: [32, 5, 32] })
  const edge = pixel(20, 20)
  assert.ok(edge.w[3] < 1e-6 && edge.w[0] > 0 && sum(edge.w) < 1, `${edge.w}`)
  // A probe on no lit surface (a negative depth) weighs nothing, even on the plane.
  at([2, 2], { depth: -1 })
  assert.equal(pixel(20, 20).w[3], 0)
  // Just off the plane the first test leaves little and the gentler one leaves most: the fallback.
  at([2, 2], { P: [32, 0.2, 32] })
  const near = pixel(20, 20)
  assert.ok(
    near.fallback[3] > 10 * near.w[3] && near.fallback[3] > 0.05,
    `${near.w[3]} against ${near.fallback[3]}`,
  )
})

test('a pixel that lights its backface weighs a probe off its plane by the foliage scale, a quarter of the plane scale', () => {
  const { at, pixel } = interpolationOf()
  for (const tile of [
    [1, 1],
    [2, 1],
    [1, 2],
  ])
    at(tile)
  at([2, 2], { P: [32, 0.1, 32] })
  // The probe lies 0.1 off the plane, a relative distance of 0.01 over a depth of 10: squared, 1e-4.
  const bilinear = pixel(20, 20).w[3] / Math.pow(2, -10000 * 1e-4)
  assert.ok(bilinear > 0)
  assert.ok(Math.abs(pixel(20, 20, true).w[3] / bilinear - Math.pow(2, -2500 * 1e-4)) < 1e-5)
  assert.ok(pixel(20, 20, true).w[3] > pixel(20, 20).w[3])
})

test('the place a pixel reads its probes from is cut to a whole pixel once the noise is added, as an unsigned coordinate cuts it', () => {
  const { at, pixel, moved } = interpolationOf()
  for (const tile of [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ])
    at(tile)
  assert.deepEqual(moved(20, 20, [0.75, 0.75]).w, pixel(20, 20).w, 'a fraction above is lost')
  assert.deepEqual(moved(20, 20, [-0.25, -0.25]).w, pixel(19, 19).w, 'a fraction below is a pixel')
})
