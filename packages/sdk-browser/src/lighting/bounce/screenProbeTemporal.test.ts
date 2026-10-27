// The screen probes' temporal pass and integration: the occlusion texel a pixel reads and the tile its neighbourhood is taken in, and what the
// integration's targets hold of the numbers it writes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { SP_OCCLUSION_CELLS } from './screen/occlusionWgsl.ts'
import { SCREEN_PROBE_FLAGS } from './screen/screenProbeLayout.ts'
import { spIntegrate } from './screen/integrateWgsl.ts'
import { INTEGRATE_BINDINGS } from './screen/integratePassWgsl.ts'
import { temporalShader } from './screen/temporalWgsl.ts'

type OcclusionPick = { cell: number[]; moved: number[]; valid: boolean }

/** The occlusion texel pick and the neighbourhood of a 64 by 64 image whose occlusion is cut at `downsample`, run on the shipped text: every
 *  texel `stands` on the pixel `downsample` times its cell, lies on the plane `lift` above the pixel's and is lit; the texel `(x, y)` holds `x` as its amount. */
function occlusionOf(downsample: number, lift = 0, flags = 0) {
  const run = shaderRun<{
    spOcclusionCell: (pixel: number[], s: object, noise: number) => OcclusionPick
    spOcclusionHood: (pick: OcclusionPick, local: number[]) => number[][]
    spSkyAt: (cell: number[], N: number[], strength: number) => number[]
  }>(
    temporalShader(downsample, [4, 2], false, false, 1),
    ['spOcclusionCell', 'spOcclusionHood', 'spSkyAt'],
    {
      SP_OCCLUSION_DOWNSAMPLE: downsample,
      SP_GROUP: 8,
      sp: { size: [64, 64, 16, 0], mode: [0, 0, flags, 0], foliage: [0.7, 1, 0, 0] },
      spOcclusionLast: () => [63 / downsample, 63 / downsample].map(Math.trunc),
      spOcclusionPixel: (cell: number[]) => [cell[0] * downsample, cell[1] * downsample],
      spOcclusionTexel: (cell: number[]) => [0, 0, 1, cell[0]],
      spSurfaceAt: () => ({ lit: true, P: [0, lift, 0], N: [0, 1, 0] }),
      spDepthOf: () => 10,
    },
  )
  return run
}

test('a pixel the occlusion texels can stand for reads the one its noise picks among them, and one nothing can stand for reads the first and is not trusted', () => {
  const surface = { P: [0, 0, 0], N: [0, 1, 0] }
  // Only the texel on the pixel's own place weighs: it is the one picked, the last of the four.
  const stood = occlusionOf(2).spOcclusionCell([10, 10], surface, 0.5)
  assert.deepEqual(stood, { cell: [5, 5], moved: [1, 1], valid: true })
  // Its point lies 0.447 off the plane: a weight of 4 · 2^-10, under the hundredth the pixel is rebuilt from.
  const apart = occlusionOf(2, 0.447).spOcclusionCell([10, 10], surface, 0.5)
  assert.deepEqual(apart, { cell: [4, 4], moved: [0, 0], valid: false })
  // At the image's size the texel is the pixel's own, whatever the noise.
  assert.deepEqual(occlusionOf(1).spOcclusionCell([10, 10], surface, 0.5), {
    cell: [10, 10],
    moved: [0, 0],
    valid: true,
  })
})

test('the pixel zero is counted from the cell before the first, as the pick weighs it: the texel read is the pick’s offset past that cell', () => {
  const surface = { P: [0, 0, 0], N: [0, 1, 0] }
  // The cell before the first lies outside the image and weighs nothing: only the cell (0, 0) weighs, the last of the four, offset (1, 1) from the cell (-1, -1).
  assert.deepEqual(occlusionOf(2).spOcclusionCell([0, 0], surface, 0.5), {
    cell: [0, 0],
    moved: [1, 1],
    valid: true,
  })
})

test('the texels a pixel weighs lie within two pixels of it, so that the triangle that weighs them is never under zero', () => {
  const cellsOf = (x: number) => [0, 1].map((o) => Math.floor((x + 0.5) / 2 - 0.5) + o)
  for (let frame = 0; frame < 4; frame++) {
    const { spOcclusionPixel } = shaderRun<{ spOcclusionPixel: (cell: number[]) => number[] }>(
      wgslModule(spCommon([4, 2]), SP_OCCLUSION_CELLS),
      ['spOcclusionPixel'],
      { SP_OCCLUSION_DOWNSAMPLE: 2, sp: { size: [64, 64, 16, 0], frames: [frame, 0, 0, 0] } },
    )
    for (let x = 1; x < 40; x++)
      for (const cx of cellsOf(x))
        for (const cy of cellsOf(x)) {
          const at = spOcclusionPixel([cx, cy])
          assert.ok(Math.abs(at[0] - x) <= 2 && Math.abs(at[1] - x) <= 2, `${frame} ${x}: ${at}`)
        }
  }
})

test('the neighbourhood of an occlusion texel leaves out the texels past the workgroup’s tile, which only a downsampled occlusion has', () => {
  const hood = (downsample: number, cell: number[], moved: number[], local: number[]) =>
    occlusionOf(downsample).spOcclusionHood({ cell, moved, valid: true }, local)[0][3]
  // Four texels over a six wide tile: the texel picked at its right edge has no right neighbours, so the mean is of the two columns left.
  assert.equal(hood(2, [10, 10], [1, 0], [7, 1]), 9.5)
  // Away from the edge all nine count: the column of the texel is the mean.
  assert.equal(hood(2, [10, 10], [0, 0], [3, 3]), 10)
  // At the image's size the tile holds the workgroup and a texel round it: every texel has its eight.
  assert.equal(hood(1, [10, 10], [0, 0], [7, 7]), 10)
})

test('the integration’s targets hold a light as the 11-11-10 word does, rounded either way by the noise, and the share that moves on eight bits', () => {
  const stored = shaderRun<{
    spStored: (c: number[], e: number) => number[]
    spStoredMoving: (moving: number) => number
  }>(
    wgslModule(
      spIntegrate({ ...INTEGRATE_BINDINGS.at, extraAo: false, bentNormal: false, mips: 1 }),
    ),
    ['spStored', 'spStoredMoving'],
    {},
  )
  // Half way between two steps of the six bit mantissa: the noise decides which.
  const between = [1.0078125, 1.0078125, 1.0078125]
  assert.equal(stored.spStored(between, 0.01)[0], 1)
  assert.equal(stored.spStored(between, 0.99)[0], 1.015625)
  assert.deepEqual(stored.spStored([0, 0, 0], 0.9), [0, 0, 0], 'none stays none')
  assert.equal(stored.spStoredMoving(0.004), 1 / 255, 'the least share is one step')
  assert.equal(stored.spStoredMoving(0.2), 51 / 255)
  assert.equal(stored.spStoredMoving(7), 1, 'held to one')
})

test('the open sky weighs the rough specular only where the occlusion is applied during the integration, and is the whole sky else', () => {
  const N = [0, 1, 0]
  const sky = (flags: number) => occlusionOf(1, 0, flags).spSkyAt([0, 0], N, 1)
  const F = SCREEN_PROBE_FLAGS
  assert.deepEqual(
    sky(F.occlusion),
    [0, 1, 0, 1],
    'the occlusion searched but not applied here: none',
  )
  assert.deepEqual(sky(F.occlusionInIntegration), [0, 1, 0, 1], 'applied but not searched: none')
  assert.equal(
    sky(F.occlusion | F.occlusionInIntegration)[3],
    0,
    'applied: the amount of the texel (here 0)',
  )
})

test('where the integration applied the occlusion to the light already, the temporal pass keeps none of it: no cell picked, no neighbourhood, its history occlusion the whole amount', () => {
  const code = temporalShader(2, [4, 2], true, true, 1)
  assert.match(
    code,
    /let occluded=spFlag\(SP_FLAG_OCCLUSION\)&&!spFlag\(SP_FLAG_OCCLUSION_IN_INTEGRATION\);/,
  )
  assert.match(code, /if\(occluded\)\{pick=spOcclusionCell\(at,s,noise\);\}/)
  assert.match(
    code,
    /var occlusion=select\(vec4f\(0\.0,0\.0,1\.0,1\.0\),spOcclusionTexel\(pick\.cell\),occluded\);/,
  )
  assert.match(
    code,
    /if\(occluded&&spFlag\(SP_FLAG_OCCLUSION_TEMPORAL\)&&sp\.occlusion\.w>0\.0\)\{/,
  )
})
