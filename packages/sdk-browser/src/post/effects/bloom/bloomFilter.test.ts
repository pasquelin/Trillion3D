// The bloom's filters: its levels are the image halved, the Gaussian kernel is the bell the
// bilinear reads were made to follow, each level blurs over the share of its width the settings
// say, the glow adds light rather than moving it, and the shipped blur runs to what a convolution
// of the image gives.
import test from 'node:test'
import assert from 'node:assert/strict'
import { bloomBytes, bloomTintScale } from './bloomFilter.ts'
import { DEFAULT_BLOOM } from '../webgpuEffects.fixture.ts'
import { chainSizes } from '../../filters/levelSizes.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../../sdk-core/src/contracts/bloomOptions.ts'
import {
  GAUSSIAN_MAX_TAPS,
  gaussianHalvesWidth,
  gaussianKernel,
  gaussianRadius,
  gaussianTapsOf,
} from '../../filters/gaussianKernel.ts'
import { BLUR_EDGES, BLUR_PARAMS, GAUSSIAN_WGSL } from '../../filters/gaussianWgsl.ts'
import { BLOOM_COMPOSITE_WGSL, BLOOM_SETUP_WGSL } from './bloomWgsl.ts'
import { bellOf, bilinear, texelsOf, type Image } from './bloom.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'

test('the levels are the half-size image and five more halvings, each rounded up', () => {
  assert.deepEqual(chainSizes(1920, 1080, BLOOM_LEVEL_COUNT), [
    [960, 540],
    [480, 270],
    [240, 135],
    [120, 68],
    [60, 34],
    [30, 17],
  ])
  assert.deepEqual(chainSizes(9, 5, BLOOM_LEVEL_COUNT), [
    [5, 3],
    [3, 2],
    [2, 1],
    [1, 1],
    [1, 1],
    [1, 1],
  ])
  assert.equal(chainSizes(1, 1, BLOOM_LEVEL_COUNT).length, 6, 'a level is at least one texel')
  // Three texels of the target's format a texel of the levels: the setup's image and the levels
  // under it, and the two targets of each blur.
  assert.equal(
    bloomBytes(9, 5),
    3 * 8 * (5 * 3 + 3 * 2 + 2 * 1 + 1 + 1 + 1),
    'rgba16float is eight bytes a texel',
  )
})

test('the reads of a kernel weigh each texel as the Gaussian does, at any radius', () => {
  const taps = gaussianTapsOf()
  for (const radius of [0.19, 0.4, 1, 2.5, 5.76, 6, 6.01, 9.6, 24, 31, 36, 38.4, 100]) {
    const count = gaussianKernel(radius, taps)
    assert.ok(count >= 2 && count <= GAUSSIAN_MAX_TAPS, `radius ${radius}: ${count} reads`)
    const texels = texelsOf(taps.offsets, taps.weights, count)
    const bell = bellOf(radius)
    let total = 0
    for (const [x, weight] of bell) {
      assert.ok(Math.abs((texels.get(x) ?? 0) - weight) < 2e-7, `radius ${radius}, texel ${x}`)
      total += texels.get(x) ?? 0
    }
    assert.ok(Math.abs(total - 1) < 1e-6, `radius ${radius}: the weights sum to one`)
    for (let i = 0; i < count; i++) assert.ok(Number.isFinite(taps.offsets[i]), 'no read is lost')
  }
})

test('the levels blur by the reference radii, and from 7 texels the first pass halves the width', () => {
  // A 1080p image: its levels are 960 … 30 texels wide, a level's blur the share of its width
  // its size times the scale says, in percent, the radius half of that across.
  const radii = chainSizes(1920, 1080, BLOOM_LEVEL_COUNT).map(([width], level) =>
    gaussianRadius(width, DEFAULT_BLOOM.levels[level].size * DEFAULT_BLOOM.sizeScale),
  )
  assert.deepEqual(
    radii.map((radius) => Number(radius.toFixed(2))),
    [5.76, 9.6, 9.6, 24, 36, 38.4],
  )
  assert.deepEqual(radii.map(gaussianHalvesWidth), [false, true, true, true, true, true])
  const taps = gaussianTapsOf()
  assert.deepEqual(
    radii.map((radius) => gaussianKernel(radius, taps)),
    [7, 11, 11, 25, 32, 32],
    'reads a pass: the radius rounded up, two texels a read, no wider than 31 texels out',
  )
  assert.equal(gaussianHalvesWidth(6.99), false)
  assert.equal(gaussianHalvesWidth(7), true)
})

test('the glow adds the tints times the intensity over the levels: about 9 % of the light', () => {
  assert.equal(bloomTintScale(0.675), 0.1125)
  const tints = DEFAULT_BLOOM.levels.reduce((sum, { tint }) => sum + tint[0], 0)
  assert.ok(Math.abs(tints - 0.7951) < 1e-9)
  assert.ok(Math.abs(tints * bloomTintScale(DEFAULT_BLOOM.intensity) - 0.08945) < 1e-4)
})

/** One horizontal pass of the shipped blur, run in doubles over a row of `w` texels that fill
 *  `fill` of their texture's width, its reads taken at `radius`, past the row as `edge` says. */
function blurRow(row: Image, radius: number, edge: keyof typeof BLUR_EDGES, fill = 1) {
  const taps = gaussianTapsOf(),
    count = gaussianKernel(radius, taps)
  const blur = {
    axis: [1 / row.w, 0],
    inTexel: [1 / row.w, 1 / row.h],
    outTexel: [1 / row.w, 1 / row.h],
    scale: [fill, 1],
    count,
    edge: BLUR_EDGES[edge],
    plus: 0,
    taps: Array.from({ length: GAUSSIAN_MAX_TAPS }, (_, i) => [
      taps.offsets[i],
      taps.weights[i],
      taps.weights[i],
      taps.weights[i],
    ]),
  }
  // The texture is `1 / fill` times as wide as the row, which lies in its first columns: the rest
  // was never written, zeros.
  const texture: Image = {
    data: new Float64Array(Math.round(row.w / fill)),
    w: Math.round(row.w / fill),
    h: 1,
  }
  texture.data.set(row.data)
  const scope = {
    blur,
    image: 'image',
    reader: 'reader',
    extra: 'extra',
    textureSampleLevel: (_: string, __: string, uv: number[]) => {
      const v = bilinear(texture, uv[0] * texture.w, 0.5)
      return [v, v, v, v]
    },
  }
  const { blurTaps } = shaderRun<{ blurTaps: (pixel: number[]) => number[] }>(
    GAUSSIAN_WGSL,
    ['fetch', 'blurTaps'],
    scope,
  )
  return Array.from({ length: row.w }, (_, x) => blurTaps([x + 0.5, 0.5, 0, 1])[0])
}

test('the shipped blur is the image convolved with the bell, past the edge as it says, in doubles', () => {
  const random = lcgRandom(7)
  const row: Image = { data: Float64Array.from({ length: 41 }, () => random() * 3), w: 41, h: 1 }
  /** The row convolved with the bell of `radius`, a texel past an edge as `at` names it. */
  const convolved = (radius: number, at: (x: number) => number | undefined) =>
    Array.from({ length: row.w }, (_, x) => {
      let sum = 0
      for (const [j, weight] of bellOf(radius)) sum += weight * (row.data[at(x + j) ?? -1] ?? 0)
      return sum
    })
  const zero = (x: number) => (x < 0 || x >= row.w ? undefined : x)
  // Mirror-repeat: the texel past an edge is the one the edge folds it back on.
  const mirror = (x: number) => (x < 0 ? -x - 1 : x >= row.w ? 2 * row.w - 1 - x : x)
  const clamp = (x: number) => Math.min(Math.max(x, 0), row.w - 1)
  for (const radius of [1.2, 5.76, 9.6, 24]) {
    const edges = {
      zero: blurRow(row, radius, 'zero'),
      mirror: blurRow(row, radius, 'mirror'),
      // The row read as the first half of a texture twice as wide: the same blur.
      cornered: blurRow(row, radius, 'zero', 0.5),
      corneredMirror: blurRow(row, radius, 'mirror', 0.5),
      corneredClamp: blurRow(row, radius, 'clamp', 0.5),
    }
    const expected = {
      zero: convolved(radius, zero),
      mirror: convolved(radius, mirror),
      clamp: convolved(radius, clamp),
    }
    for (let x = 0; x < row.w; x++) {
      assert.ok(Math.abs(edges.zero[x] - expected.zero[x]) < 1e-6, `zero ${radius}, ${x}`)
      assert.ok(Math.abs(edges.mirror[x] - expected.mirror[x]) < 1e-6, `mirror ${radius}, ${x}`)
      assert.ok(Math.abs(edges.cornered[x] - expected.zero[x]) < 1e-6, `cornered ${radius}, ${x}`)
      // The texels of the texture past the row were never written: no edge reads them.
      assert.ok(
        Math.abs(edges.corneredMirror[x] - expected.mirror[x]) < 1e-6,
        `corner mirror ${radius}, ${x}`,
      )
      assert.ok(
        Math.abs(edges.corneredClamp[x] - expected.clamp[x]) < 1e-6,
        `corner clamp ${radius}, ${x}`,
      )
    }
  }
  const flat: Image = { data: new Float64Array(41).fill(2), w: 41, h: 1 }
  for (const value of blurRow(flat, 9.6, 'clamp')) assert.ok(Math.abs(value - 2) < 1e-6)
  // The uniform is the struct the shader reads: its taps at the word the layout says.
  assert.equal(BLUR_PARAMS.at.taps, 12)
})

/** The bloom's setup of one pixel `c` of the half-size image, the local exposure's `gain` known,
 *  run as the shipped text, in doubles. */
function setup(c: number[], threshold: number, layers: number, exposure: number, gain = 3) {
  const scope = {
    halfImage: 'image',
    halfReader: 'reader',
    setup: { outTexel: [1 / 8, 1 / 4], threshold, layers },
    finish: { look: [0.4, exposure, 0, 0] },
    textureSampleLevel: () => c,
    lightLog: () => 0,
    localGain: (_: number, uv: number[]) => (uv[0] === 2 / 8 && uv[1] === 1 / 4 ? gain : NaN),
  }
  const { bloomSetup } = shaderRun<{ bloomSetup: (pixel: number[]) => number[] }>(
    BLOOM_SETUP_WGSL,
    ['bloomSetup'],
    scope,
  )
  return bloomSetup([2.5, 1.5, 0, 1])
}

test('the setup applies the local exposure read at the pixel’s corner, then the threshold', () => {
  const pixel = [1, 2, 4, 0.5]
  assert.deepEqual(setup(pixel, -1, 0, 0.5), pixel, 'no layers, no threshold: the image as it is')
  // The gain multiplies the colour, never the coverage.
  assert.deepEqual(setup(pixel, -1, 1, 0.5), [3, 6, 12, 0.5])
  // Past the threshold the pixel counts by how far its exposed luminance — the working-space
  // luminance, times the exposure — clears it, over two.
  const luminance = 0.2126390059 + 2 * 0.7151686788 + 4 * 0.0721923154
  const amount = Math.min(Math.max((luminance * 0.5 - 0.5) * 0.5, 0), 1)
  const out = setup(pixel, 0.5, 0, 0.5)
  pixel.forEach((value, i) => assert.ok(Math.abs(out[i] - value * amount) < 1e-9))
  assert.deepEqual(setup(pixel, 100, 0, 0.5), [0, 0, 0, 0], 'a pixel under it glows none')
})

test('the composite adds the glow to the pixel, light and coverage, coverage up to 1', () => {
  const scope = {
    scene: 'scene',
    glow: 'glow',
    reader: 'reader',
    textureDimensions: () => [8, 4],
    textureLoad: () => [1, 2, 3, 0.75],
    textureSampleLevel: (_: string, __: string, uv: number[]) => [uv[0], uv[1], 0.5, 0.5],
  }
  const { composite } = shaderRun<{ composite: (pixel: number[]) => number[] }>(
    BLOOM_COMPOSITE_WGSL,
    ['composite'],
    scope,
  )
  const out = composite([2.5, 1.5, 0, 1])
  assert.deepEqual(out, [1 + 2.5 / 8, 2 + 1.5 / 4, 3.5, 1], 'a coverage of 1')
})
