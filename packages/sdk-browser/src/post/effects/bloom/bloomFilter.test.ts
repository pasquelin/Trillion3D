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
import { GAUSSIAN_BLUR_RULES } from '../../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import {
  GAUSSIAN_MAX_TAPS,
  gaussianHalvesWidth,
  gaussianKernel,
  gaussianRadius,
  gaussianTapCap,
  gaussianTapsOf,
} from '../../filters/gaussianKernel.ts'
import { BLUR_BYTES, BLUR_EDGES, BLUR_PARAMS, GAUSSIAN_WGSL } from '../../filters/gaussianWgsl.ts'
import { BLOOM_COMPOSITE_WGSL, BLOOM_SETUP_WGSL } from './bloomWgsl.ts'
import { CONVOLUTION_INPUT_WGSL } from './convolution/inputWgsl.ts'
import { fftShader } from './convolution/fftWgsl.ts'
import { bellOf, bilinear, texelsOf, type Image } from './bloom.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { createBlurUniforms, WHITE } from '../../filters/blurUniforms.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { written } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'

test('the levels are the half-size image and five more halvings, each rounded up', () => {
  const sizes = (w: number, h: number) => chainSizes(w, h, BLOOM_LEVEL_COUNT).join(' ')
  assert.equal(sizes(1920, 1080), '960,540 480,270 240,135 120,68 60,34 30,17')
  assert.equal(sizes(9, 5), '5,3 3,2 2,1 1,1 1,1 1,1')
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

test('a sample scale cuts or extends the reach, the loop mode raises the most reads; the weights stay the radius’s', () => {
  const taps = gaussianTapsOf()
  const reads = (radius: number, scale: number, mode = 0) =>
    gaussianKernel(radius, taps, 0, scale, gaussianTapCap(mode))
  // The reach is the radius times the scale, rounded up: 10, 6, 20 texels out of 9.6; the scale is held
  // to 0.1 … 10, so a scale of 0.01 reads as 0.1 (1 texel out) and 50 as 10 (the most).
  assert.deepEqual(
    [1, 0.6, 2, 0.01, 50].map((scale) => reads(9.6, scale)),
    [11, 7, 21, 2, 32],
  )
  assert.deepEqual([0, 1, 2].map(gaussianTapCap), [32, GAUSSIAN_MAX_TAPS, GAUSSIAN_MAX_TAPS])
  // A radius of 100 under mode 0 is held to 31 and its 32 reads; under mode 1 or 2 it reads 101, the
  // weights of a bell 100 wide, so the centre weighs less than the narrower bell's.
  const centre = (mode: number) => texelsOf(taps.offsets, taps.weights, reads(100, 1, mode)).get(0)!
  assert.deepEqual([reads(100, 1, 0), reads(100, 1, 1), reads(100, 1, 2)], [32, 101, 101])
  assert.ok(centre(1) < centre(0))
})

test('a blur keeps its two uniform buffers across sizes, and sends the words that changed, again when the kernel’s sizing moves', () => {
  const gpu = fakeDevice()
  const look = resolveSettings(GAUSSIAN_BLUR_RULES, {})
  const blur = createBlurUniforms(gpu.device, 'zero', 'blur')
  const resize = (width: number, scale = 1) =>
    blur.resize(width, width / 2, 10, { ...look, gaussianSampleScale: scale }, WHITE, false)
  resize(64)
  const kept = [...blur.buffers]
  resize(128)
  assert.deepEqual([blur.buffers, gpu.buffers.length, gpu.writes.length], [kept, 2, 4])
  assert.ok(
    gpu.writes.every((write) => written(write).byteLength < BLUR_BYTES),
    'the used prefix',
  )
  resize(128)
  assert.equal(gpu.writes.length, 4, 'held: nothing written')
  resize(128, 0.6)
  assert.equal(gpu.writes.length, 6, 'a sample scale moved: both kernels again')
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
  // From the radius the view says: 7 halves all but the finest level, 0 every one, the default,
  // 100, none of a 1080p image's.
  const halved = (threshold: number) =>
    radii.map((radius) => gaussianHalvesWidth(radius, threshold))
  assert.deepEqual(halved(7), [false, true, true, true, true, true])
  assert.deepEqual(halved(0), [true, true, true, true, true, true])
  const fast = GAUSSIAN_BLUR_RULES.gaussianFastBlurThreshold.default
  assert.deepEqual(halved(fast), Array(6).fill(false))
  const taps = gaussianTapsOf()
  assert.deepEqual(
    radii.map((radius) => gaussianKernel(radius, taps)),
    [7, 11, 11, 25, 32, 32],
    'reads a pass: the radius rounded up, two texels a read, no wider than 31 texels out',
  )
  assert.equal(gaussianHalvesWidth(6.99, 7), false)
  assert.equal(gaussianHalvesWidth(7, 7), true)
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
  const texel = [1 / row.w, 1 / row.h]
  const taps4 = Array.from({ length: GAUSSIAN_MAX_TAPS }, (_, i) => [
    taps.offsets[i],
    ...Array(3).fill(taps.weights[i]),
  ])
  const blur = { axis: [texel[0], 0], inTexel: texel, outTexel: texel, scale: [fill, 1], count }
  // The texture is `1 / fill` times as wide as the row, which lies in its first columns: the rest
  // was never written, zeros.
  const wide = Math.round(row.w / fill)
  const texture: Image = { data: new Float64Array(wide), w: wide, h: 1 }
  texture.data.set(row.data)
  const scope = {
    blur: { ...blur, plus: 0, edge: BLUR_EDGES[edge], taps: taps4 },
    image: 'image',
    reader: 'reader',
    extra: 'extra',
    textureSampleLevel: (_: string, __: string, uv: number[]) => {
      const v = bilinear(texture, uv[0] * texture.w, 0.5)
      return [v, v, v, v]
    },
  }
  const { blurTaps } = shaderRun<Fragment>(GAUSSIAN_WGSL, ['fetch', 'blurTaps'], scope)
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
    const check = (name: string, got: number[], at: (x: number) => number | undefined) => {
      const want = convolved(radius, at)
      got.forEach((v, x) => assert.ok(Math.abs(v - want[x]) < 1e-6, `${name} ${radius}, ${x}`))
    }
    check('zero', blurRow(row, radius, 'zero'), zero)
    check('mirror', blurRow(row, radius, 'mirror'), mirror)
    // The row read as the first half of a texture twice as wide: the same blur, no edge reading the
    // texels past the row, which were never written.
    check('cornered', blurRow(row, radius, 'zero', 0.5), zero)
    check('corner mirror', blurRow(row, radius, 'mirror', 0.5), mirror)
    check('corner clamp', blurRow(row, radius, 'clamp', 0.5), clamp)
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
    finish: { look: [0.4, exposure, layers, 0] },
    textureSampleLevel: () => c,
    lightLog: () => 0,
    localGain: (_: number, uv: number[]) => (uv[0] === 2 / 8 && uv[1] === 1 / 4 ? gain : NaN),
  }
  return fragment(BLOOM_SETUP_WGSL, 'bloomSetup', scope)
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

test('the composite adds the glow to the pixel’s light and keeps its alpha', () => {
  const composite = (look: object) =>
    fragment(BLOOM_COMPOSITE_WGSL, 'composite', {
      scene: 'scene',
      glow: 'glow',
      reader: 'reader',
      dirtImage: 'dirt',
      look,
      textureDimensions: () => [8, 4],
      textureLoad: () => [1, 2, 3, 0.75],
      textureSampleLevel: (image: string, _: string, uv: number[]) =>
        image === 'dirt' ? [0.5, 0.25, 1, 1] : [uv[0], uv[1], 0.5, 0.5],
    })
  const none = { keep: [0, 0, 0, 0], dirt: [0, 0, 0, 0], lens: [0, 0, 1, 1] }
  assert.deepEqual(composite(none), [1 + 2.5 / 8, 2 + 1.5 / 4, 3.5, 0.75], 'the pixel’s alpha')
  // The glow times the dirt the mask shows, the image times what the glow left it.
  const dirty = composite({ ...none, dirt: [2, 2, 2, 1] })
  assert.deepEqual(dirty, [1 + (2.5 / 8) * 2, 2 + (1.5 / 4) * 1.5, 3 + 0.5 * 3, 0.75])
  assert.deepEqual(composite({ ...none, keep: [0.5, 0.25, 1, 1] }), [
    0.5 + 2.5 / 8,
    0.5 + 1.5 / 4,
    3.5,
    0.75,
  ])
})

test('a cross gives the centre texel a share of each pass, the plain bell at 0', () => {
  const kernel = (cross?: number) => {
    const taps = gaussianTapsOf(),
      count = gaussianKernel(9.6, taps, cross)
    // A pair the cross leaves no weight stays on a texel: a read at no place is not sent to the sampler.
    assert.ok(taps.offsets.slice(0, count).every(Number.isFinite), `cross ${cross}`)
    return texelsOf(taps.offsets, taps.weights, count)
  }
  assert.deepEqual(kernel(0), kernel()) // no cross: the same bell
  for (const cross of [1, 2.5]) assert.equal(kernel(cross).get(0), 1) // blurs nothing
  assert.ok(kernel(0.5).get(0)! > kernel(0).get(0)! && kernel(0.5).get(0)! < 1)
})

type Fragment = Record<string, (pixel: number[]) => number[]>
const fragment = (code: typeof BLOOM_SETUP_WGSL, name: string, scope: object) =>
  shaderRun<Fragment>(code, [name], scope)[name]([2.5, 1.5, 0, 1])

test('the convolution’s input applies the local exposure; its first pass boosts what is bright', () => {
  const read = (c: number[], layers = 0) =>
    fragment(CONVOLUTION_INPUT_WGSL, 'convolutionInput', {
      image: 'image',
      reader: 'reader',
      input: { outTexel: [1 / 8, 1 / 4], layers },
      finish: { look: [0, 1, 1, 0] },
      textureSampleLevel: () => c,
      lightLog: () => 0,
      localGain: () => 2,
    })
  assert.deepEqual(read([1, 2, 4, 1]), [1, 2, 4, 1], 'no layers: the pixel as it is')
  assert.deepEqual(read([1, 2, 4, 1], 1), [2, 4, 8, 1], 'the local exposure multiplies the colour')
  const load = (c: number[], { exposure = 1, boost = 1 } = {}) =>
    shaderRun<{ loaded: (at: number[]) => number[] }>(fftShader(256), ['loaded'], {
      fft: { mode: [0, boost, 0, 0], lift: [7, 15000, 15, exposure] },
      source: 'source',
      textureLoad: () => c,
    }).loaded([0, 0])
  const near = (c: number[], v: number, o = {}) => assert.ok(Math.abs(load(c, o)[0] - v) < 0.01)
  assert.deepEqual(load([3, 3, 3, 1]), [3, 3, 3, 1]) // under 7 in exposed luminance: as it is
  near([20, 20, 20, 1], 202) // 15 × (20 − 7) + 7
  near([20, 20, 20, 1], 104, { exposure: 0.5 }) // 10 exposed → 52, the colour scaled by 5.2
  near([1e4, 1e4, 1e4, 1], 15000) // held to the most
  assert.deepEqual(load([20, 20, 20, 1], { boost: 0 }), [20, 20, 20, 1]) // a max under the min: off
  assert.deepEqual(load([-1, NaN, 2, NaN]), [0, 0, 2, 0]) // no negative light, no number that is none
  // A transform's module is made for its line: 4 values a thread holds, and the factors by its stride.
  assert.ok(fftShader(1024).includes('const MAX_LINE=1024u;'))
  assert.ok(fftShader(256).includes('const MAX_LINE=256u;') && fftShader(256) !== fftShader(1024))
})
