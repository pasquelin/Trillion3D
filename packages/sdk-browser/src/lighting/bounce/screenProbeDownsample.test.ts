// The screen probes' integration run at a reduction of two (`screenProbeIntegrateDownsampleFactor`): the pixel each cell of the integration lights, the
// texel each pixel reads back, the weights and the pick of the four cells round a pixel, and what a view holds for it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { kernelShapeOf, screenProbeSources, shapeKey } from './screen/kernels.ts'
import { integrateShader, tileShader } from './screen/integratePassWgsl.ts'
import { temporalEntries, temporalShader } from './screen/temporalWgsl.ts'
import { stochasticShader } from './screen/stochasticWgsl.ts'
import { screenProbeBytes } from './screen/resources.ts'
import { integrateTiles, screenProbeGeometry } from './screen/screenProbeLayout.ts'

const twice = screenProbeSettings({
  screenProbes: 'ultra',
  screenProbeIntegrateDownsampleFactor: 2,
})

test('a cell of the integration lights the pixel of its block that the four-rooks pattern names, held in the image; at the image’s size a cell is its pixel', () => {
  const run = (integrate: number, frame: number, size: number[]) =>
    shaderRun<{
      spIntegratePixel: (cell: number[]) => number[]
      spIntegrateSize: () => number[]
    }>(
      integrateShader(1, integrate, 0, [4, 2], false, false, 1, true),
      ['spIntegratePixel', 'spIntegrateSize'],
      {
        SP_INTEGRATE_DOWNSAMPLE: integrate,
        sp: { size: [...size, 16, 0], frames: [frame, 0, 0, 0] },
      },
    )
  const at = run(2, 0, [64, 64])
  // The cell (3, 3) is the fourth of its block: rank 3, the pixel to the right on the top row.
  assert.deepEqual(at.spIntegratePixel([3, 3]), [7, 6])
  assert.deepEqual(
    at.spIntegratePixel([2, 2]),
    [4, 5],
    'the first of the block moved by the frame: the pixel below',
  )
  // The four cells of a block take four different pixels of their own blocks in one image, and the same cell takes the four in turn over four images.
  const seen = new Set<string>()
  for (let frame = 0; frame < 4; frame++)
    seen.add(String(run(2, frame, [64, 64]).spIntegratePixel([2, 2])))
  assert.equal(seen.size, 4)
  // Held in the image: the last cell of an odd side stands for the last pixel.
  assert.deepEqual(run(2, 0, [7, 7]).spIntegratePixel([3, 3]), [6, 6])
  assert.deepEqual(run(2, 0, [7, 9]).spIntegrateSize(), [4, 5])
  const whole = run(1, 3, [7, 9])
  assert.deepEqual(
    [whole.spIntegratePixel([3, 3]), whole.spIntegrateSize()],
    [
      [3, 3],
      [7, 9],
    ],
  )
})

test('a pixel reads the texel of the integration its offset names, counted from the cell the pick weighed it from, held to the integration’s texels, and trusts it only where the offset says four texels could stand for it', () => {
  const run = (integrate: number, word: number) => {
    const { spFreshAt } = shaderRun<{
      spFreshAt: (at: number[]) => { texel: number[]; valid: boolean }
    }>(temporalShader(1, [4, 2], true, false, integrate), ['spFreshAt'], {
      sp: { size: [7, 9, 16, 0] },
      offsetsIn: 'offsets',
      textureLoad: () => [word, 0, 0, 0],
    })
    return spFreshAt
  }
  // Offset (1, 0), valid: the pixel (5, 5) less one is 4, over two 2, one right of it.
  assert.deepEqual(run(2, 1 | 4)([5, 5]), { texel: [3, 2], valid: true })
  assert.deepEqual(run(2, 2 | 4)([5, 5]), { texel: [2, 3], valid: true })
  // The pixel zero is counted from the texel before the first, as the pick weighed it (`downsampleBase`): a texel before the first does not weigh, so the offset (1, 1) there is the texel 0;
  // the pixel one is counted from the texel 0, the offset (1, 1) there the texel 1; and the far edge is held to the last texel (4 by 5 for 7 by 9).
  assert.deepEqual(run(2, 4)([0, 0]), { texel: [0, 0], valid: true })
  assert.deepEqual(run(2, 1 | 2 | 4)([0, 0]), { texel: [0, 0], valid: true })
  assert.deepEqual(run(2, 1 | 2 | 4)([1, 1]), { texel: [1, 1], valid: true })
  assert.deepEqual(run(2, 1 | 4)([1, 0]), { texel: [1, 0], valid: true })
  assert.deepEqual(run(2, 1 | 2 | 4)([6, 8]), { texel: [3, 4], valid: true })
  assert.deepEqual(run(2, 1 | 2 | 4)([40, 40]), { texel: [3, 4], valid: true })
  // No offset written (the four texels could not stand for the pixel): the texel is the first and not trusted.
  assert.deepEqual(run(2, 0)([5, 5]), { texel: [2, 2], valid: false })
  // At the image’s size the pixel reads its own, whatever the word.
  assert.deepEqual(run(1, 0)([5, 5]), { texel: [5, 5], valid: true })
})

test('the four cells round a pixel weigh by the triangle of their distance, the plane of the pixel and its normal; a cell with no surface, past the image or across an edge weighs nothing', () => {
  const cache = (z = 1) => Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => z))
  const normals = (n: number[]) =>
    Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => n))
  const surface = { P: [10.5, 0, 10.5], N: [0, 1, 0] }
  const weights = (
    depths: number[][],
    cached: number[][][],
    size = 64,
    pixel = [10, 10],
    local = [2, 2],
  ) =>
    shaderRun<{ upWeights: (pixel: number[], local: number[], s: object) => number[] }>(
      stochasticShader([4, 2]),
      ['upWeights'],
      {
        sp: { size: [size, size, 16, 0], frames: [0, 0, 0, 0] },
        // The cells along a side, as the integration counts them (the fixture divides vectors as floats).
        spIntegrateSize: () => [Math.ceil(size / 2), Math.ceil(size / 2)],
        spDepthOf: () => 10,
        // A point of the depth z lies z - 1 above the plane the surface is on.
        worldAt: (p: number[], z: number) => [p[0], z - 1, p[1]],
        cachedDepth: depths,
        cachedNormal: cached,
      },
    ).upWeights(pixel, local, surface)
  // The pixel (10, 10) lies two pixels past the first cell's pixel (8, 8): the cells' pixels stand at (8, 9), (10, 8), (9, 11) and (11, 10) — triangles 0, 0, 1 and 2.
  const flat = weights(cache(), normals([0, 1, 0]))
  assert.deepEqual(
    flat.map((w) => Math.round(w * 1e6) / 1e6),
    [0, 0, 1, 2],
  )
  // A cell on another plane (a point one above the pixel’s: a tenth of its depth, past anything the weight lets by) or with no surface weighs nothing.
  const lifted = cache()
  lifted[1][2] = 2
  assert.ok(weights(lifted, normals([0, 1, 0]))[2] < 1e-9)
  const bare = cache()
  bare[2][2] = -1
  assert.equal(weights(bare, normals([0, 1, 0]))[3], 0)
  // A cell across an edge in the normal: the angle between the normals, in radians, held to one, takes its square from the weight.
  const bent = normals([0, 1, 0])
  bent[1][2] = [Math.sin(0.5), Math.cos(0.5), 0]
  assert.ok(Math.abs(weights(cache(), bent)[2] - 0.25) < 5e-3)
  const across = normals([0, 1, 0])
  across[2][2] = [1, 0, 0]
  assert.equal(weights(cache(), across)[3], 0)
  // Past the image’s downsampled size (8 cells for 16 pixels) a cell weighs nothing: the last pixel’s cells to its right and below are cells 8.
  const edge = weights(cache(), normals([0, 1, 0]), 16, [15, 15], [7, 7])
  assert.deepEqual(edge.slice(1), [0, 0, 0])
})

test('the pixel each cell stands for in the weights is the one the integration lit: both turn by the probes’ gather state frame, the stochastic lighting’s frame leaving it alone', () => {
  const sp = { size: [64, 64, 16, 0], frames: [1, 0, 2, 0] }
  const { upJitter } = shaderRun<{ upJitter: (cell: number[]) => number[] }>(
    stochasticShader([4, 2]),
    ['upJitter'],
    { sp },
  )
  const { spIntegratePixel } = shaderRun<{ spIntegratePixel: (cell: number[]) => number[] }>(
    integrateShader(1, 2, 0, [4, 2], false, false, 1, true),
    ['spIntegratePixel'],
    { SP_INTEGRATE_DOWNSAMPLE: 2, sp },
  )
  for (const cell of [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
  ])
    assert.deepEqual(
      upJitter(cell),
      spIntegratePixel(cell).map((pixel, axis) => pixel - cell[axis] * 2),
    )
})

test('the surface a cell weighs by is that of the pixel the integration lit, held in the image as it holds it: a cell of an odd image’s last row or column is never left without one', () => {
  // The last cell (3, 3) of a 7 by 7 image jittered one right is lit at (6, 6), not (7, 6) past the image.
  const { spIntegratePixel, spIntegrateSize } = shaderRun<{
    spIntegratePixel: (cell: number[]) => number[]
    spIntegrateSize: () => number[]
  }>(stochasticShader([4, 2]), ['spIntegratePixel', 'spIntegrateSize'], {
    SP_INTEGRATE_DOWNSAMPLE: 2,
    sp: { size: [7, 7, 16, 0], frames: [1, 0, 0, 0] },
  })
  assert.deepEqual(spIntegratePixel([3, 3]), [6, 6])
  assert.deepEqual(spIntegrateSize(), [4, 4])
  // The cache is filled by the thread of that pixel, and the ring reads it, for every cell inside the integration's.
  const code = stochasticShader([4, 2])
  assert.match(code, /if\(all\(spIntegratePixel\(pixel\/vec2u\(2u\)\)==pixel\)\)\{/)
  assert.match(
    code,
    /if\(all\(cell<spIntegrateSize\(\)\)\)\{\n\s*let other=spSurfaceAt\(spIntegratePixel\(cell\)\);/,
  )
  assert.match(code, /const SP_INTEGRATE_DOWNSAMPLE:u32=2u;/)
})

test('the cell a pixel takes is picked by the prefix sums of the four weights and the noise, in the order of the cells, never one that weighs nothing, the last where none is reached', () => {
  const { upOffset } = shaderRun<{ upOffset: (random: number, weights: number[]) => number[] }>(
    stochasticShader([4, 2]),
    ['upOffset'],
    {},
  )
  assert.deepEqual(upOffset(0.4, [1, 0, 0, 1]), [0, 0])
  assert.deepEqual(upOffset(0.6, [1, 0, 0, 1]), [1, 1], 'the cells that weigh nothing are skipped')
  assert.deepEqual(upOffset(0.2, [0, 1, 1, 1]), [1, 0])
  assert.deepEqual(upOffset(0.5, [0, 1, 1, 1]), [0, 1])
  assert.deepEqual(upOffset(0.9, [0, 1, 1, 1]), [1, 1])
  assert.deepEqual(upOffset(0.5, [0, 0, 0, 0]), [1, 1])
})

test('the ring of the cache round the cells inside is filled by twenty threads, each cell once: the first row, the two end cells of each row between, the last row', () => {
  const { upBorderCoord } = shaderRun<{ upBorderCoord: (index: number) => number[] }>(
    stochasticShader([4, 2]),
    ['upBorderCoord'],
    {},
  )
  const ring = new Set<string>()
  for (let index = 0; index < 20; index++) ring.add(String(upBorderCoord(index)))
  const expected = new Set<string>()
  for (let x = 0; x < 6; x++)
    for (let y = 0; y < 6; y++)
      if (x === 0 || y === 0 || x === 5 || y === 5) expected.add(`${x},${y}`)
  assert.deepEqual(ring, expected)
})

test('a level whose integration is downsampled has the pass that picks the texels and the programs of the reduction, and one at the image’s size has neither', () => {
  const full = screenProbeSources(kernelShapeOf(twice))
  const plain = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })))
  assert.deepEqual(full.stochastic!.points, ['stochasticOffsets'])
  assert.equal(plain.stochastic, undefined)
  assert.notEqual(
    shapeKey(kernelShapeOf(twice)),
    shapeKey(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' }))),
  )
  assert.match(full.tile!.code, /const SP_INTEGRATE_DOWNSAMPLE:u32=2u;/)
  assert.match(full.integrate!.code, /const SP_INTEGRATE_DOWNSAMPLE:u32=2u;/)
  assert.match(full.temporal.code, /var offsetsIn:texture_storage_2d<r32uint,read>;/)
  assert.doesNotMatch(plain.temporal.code, /offsetsIn/)
  // The occlusion applied in the integration is read at the cell’s texel; the targets are dithered by the cell’s noise.
  assert.match(full.integrate!.code, /spSkyAt\(at,s\.N,spStrengthOf\(s\.foliage\)\)/)
  assert.match(full.integrate!.code, /let e=blueNoiseScalar\(cell,sp\.size\.w%8u\);/)
  // The temporal pass binds the offsets only where it reads them.
  assert.equal(temporalEntries(true, false, 2).length - temporalEntries(true, false, 1).length, 1)
  assert.equal(temporalEntries(false, false, 2).length, temporalEntries(false, false, 1).length)
  for (const [name, source] of Object.entries(full))
    assertProgramAssembles(source.code, undefined, name)
})

test('the integration’s tile classification looks at every pixel of the block its cells stand for, and clears the texels of a tile with none lit', () => {
  const code = tileShader(2, 0, [4, 2])
  assert.match(
    code,
    /let cell=group\.xy\*8u\+local\.xy;\n let inside=all\(cell<spIntegrateSize\(\)\);/,
  )
  assert.match(
    code,
    /for\(var block=0u;block<SP_INTEGRATE_DOWNSAMPLE\*SP_INTEGRATE_DOWNSAMPLE;block\+\+\)\{/,
  )
  assert.match(code, /textureStore\(lightOut,vec2i\(cell\),vec4f\(0\.0\)\);/)
})

test('the integration’s textures and tile lists are those of the cells: a fourth of the image’s pixels at a reduction of two, the offsets added', () => {
  const geometry = (settings: typeof twice) => screenProbeGeometry(1400, 788, settings)
  const plain = screenProbeSettings({ screenProbes: 'ultra' })
  assert.ok(screenProbeBytes(geometry(twice), twice) < screenProbeBytes(geometry(plain), plain))
  assert.equal(integrateTiles({ width: 1400, height: 788 }, 2), 88 * 50)
  assert.equal(integrateTiles({ width: 1400, height: 788 }), 175 * 99)
})
