// The bloom's tent (`tent`, `bloomLevel.ts`) is the 3×3 tent of nine bilinear taps spread by the
// radius, read in pairs of texels: a pixel's axis puts on texel `n` the weights its three taps give
// it, and two neighbouring texels are one bilinear read at their weighted centre. Four reads up to
// a radius of 1, nine at most past it. The sampler clamps each texel's index, so the edges fold
// alike.
// Here the shipped text runs in doubles (`shaderRun`) against the CPU oracle's nine taps,
// over every pair of sizes a bloom draws the tent between, edges and one-texel axes included, and
// at other radii; then with a sampler that rounds the weights of its reads, to bound what that
// rounding moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { bilinear, publishedUpTaps, tapSum, type Image } from './bloom.fixture.ts'
import { bloomLevelSizes } from './bloomFilter.ts'
import { BLOOM_WGSL } from './bloomWgsl.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { functionsOf } from '../../texture/shaderRule.fixture.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from '../../lighting/deferred/shaders.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

type Size = readonly [number, number]
type Tent = (uv: number[]) => number[]
const UP = publishedUpTaps()

/** The shipped tents over four random channels of `size` texels at `radius`, their sampler
 *  rounding the weights to `weightBits` if given: `reads.taps` counts the bilinear reads, and
 *  `published` is the oracle's tent at `(x, y)` texels of the level. */
function tentsOver([w, h]: Size, radius: number, seed: number, weightBits?: number) {
  const random = lcgRandom(seed)
  const channels: Image[] = Array.from({ length: 4 }, () => ({
    data: Float64Array.from({ length: w * h }, () => random() * 4 - 1),
    w,
    h,
  }))
  const reads = { taps: 0 }
  const scope = {
    bloom: { radius, inTexel: [1 / w, 1 / h] },
    level: 'level',
    linearClamp: 'sampler',
    textureSampleLevel: (_: string, __: string, uv: number[]) => {
      reads.taps++
      return channels.map((image) => bilinear(image, uv[0] * w, uv[1] * h, weightBits))
    },
  }
  const tents = shaderRun<Record<'tent', Tent>>(
    BLOOM_WGSL,
    ['fetchLevel', 'tentHat', 'tentTexel', 'tentAxis', 'tent'],
    scope,
  )
  const published = (x: number, y: number) =>
    channels.map((image) => tapSum(image, x, y, UP, radius))
  return { ...tents, reads, published, channels }
}

/** Every size pair a bloom of an image draws the tent between: the blend reads the first level at
 *  the image's size, the upsamples each level at the size above it. */
function pairs(width: number, height: number) {
  const levels = bloomLevelSizes(width, height)
  const outs: Size[] = [[width, height], ...levels]
  return levels.map((read, i) => ({ out: outs[i], read }))
}

const near = (i: number, n: number, span: number) => i < span || i >= n - span
/** Whether a pixel of a target is one to try: the corners, a twentieth of the outer two rows and
 *  columns, where the sampler clamps, and a seeded 200 or so of the rest. */
const tried = (x: number, y: number, [w, h]: Size, random: () => number) =>
  near(x, w, 2) || near(y, h, 2)
    ? (near(x, w, 8) && near(y, h, 8)) || random() < 0.05
    : random() < 200 / (w * h)

const SIZES: Size[] = [
  [1920, 1080],
  [1281, 721],
  [64, 48],
  [101, 77],
  [9, 5],
  [7, 13],
  [5, 100],
  [3, 2],
  [2, 2],
]

test('the tent is four reads at radius 1, in doubles, on every size pair and at the edges', () => {
  const random = lcgRandom(2024)
  let compared = 0
  for (const [width, height] of SIZES)
    for (const { out, read } of pairs(width, height)) {
      const { tent, reads, published } = tentsOver(read, 1, width * 31 + height)
      for (let py = 0; py < out[1]; py++)
        for (let px = 0; px < out[0]; px++) {
          if (!tried(px, py, out, random)) continue
          const uv = [(px + 0.5) / out[0], (py + 0.5) / out[1]]
          const want = published(uv[0] * read[0], uv[1] * read[1])
          reads.taps = 0
          const got = tent(uv)
          assert.equal(reads.taps, 4, 'one pixel, four bilinear reads')
          for (let c = 0; c < 4; c++)
            assert.ok(
              Math.abs(got[c] - want[c]) < 1e-12,
              `${width}×${height}, ${out} from ${read}, pixel ${px},${py}: ${got[c]} ≠ ${want[c]}`,
            )
          compared++
        }
    }
  assert.ok(compared > 2000, `${compared} pixels compared`)
})

test('every radius reads the tent, four reads up to 1, nine at most past it', () => {
  for (const radius of [0.25, 0.5, 0.75, 1.5, 1.99, 2, 3.25, 7]) {
    const { tent, reads, published } = tentsOver([30, 17], radius, 7)
    for (const uv of [
      [0.02, 0.9],
      [0.5, 0.5],
      [0.99, 0.01],
      [0.3, 0.77],
      [0.51, 0.13],
    ]) {
      reads.taps = 0
      const got = tent(uv)
      assert.ok(reads.taps <= (radius <= 1 ? 4 : 9), `radius ${radius}: ${reads.taps} reads`)
      published(uv[0] * 30, uv[1] * 17).forEach((want, c) =>
        assert.ok(Math.abs(got[c] - want) < 1e-12, `radius ${radius}: ${got[c]} ≠ ${want}`),
      )
    }
  }
})

// The sampler holds a read's fractions to a few bits (8 on common GPUs; 4 is the least the
// standards allow). Rounding to nearest moves a fraction by half a step of 2^-bits, and a bilinear
// read by that times the larger step between the texels it blends, per axis; the weights of the
// tent sum to 1, so the tent moves by at most 2^-bits · (the largest step between neighbouring
// texels of the four-by-four block it reads at radius 1); twice that is asserted.
test("the sampler's rounding of the read fractions moves the tent within a stated bound", () => {
  for (const bits of [8, 4]) {
    let moved = 0
    for (const [width, height] of [
      [64, 48],
      [101, 77],
    ])
      for (const { out, read } of pairs(width, height)) {
        const { tent, published, channels } = tentsOver(read, 1, width, bits)
        const texel = (image: Image, x: number, y: number) =>
          image.data[clamp(y, 0, read[1] - 1) * read[0] + clamp(x, 0, read[0] - 1)]
        for (let py = 0; py < out[1]; py++)
          for (let px = 0; px < out[0]; px++) {
            const uv = [(px + 0.5) / out[0], (py + 0.5) / out[1]]
            const x0 = Math.floor(uv[0] * read[0] - 0.5) - 1,
              y0 = Math.floor(uv[1] * read[1] - 0.5) - 1
            const rounded = tent(uv),
              exact = published(uv[0] * read[0], uv[1] * read[1])
            channels.forEach((image, c) => {
              let step = 0
              for (let j = 0; j < 4; j++)
                for (let i = 0; i < 4; i++)
                  step = Math.max(
                    step,
                    Math.abs(texel(image, x0 + i, y0 + j) - texel(image, x0 + i + 1, y0 + j)),
                    Math.abs(texel(image, x0 + i, y0 + j) - texel(image, x0 + i, y0 + j + 1)),
                  )
              const gap = Math.abs(rounded[c] - exact[c])
              assert.ok(gap <= 2 * 2 ** -bits * step + 1e-12, `${bits} bits: ${gap} > ${step}`)
              if (gap > 1e-12) moved++
            })
          }
      }
    assert.ok(moved > 0, `${bits} bits: the rounding does move texels`)
  }
})

test('the composition reads the level through the one tent, a pair of weight zero unread', () => {
  const texts = [
    BLOOM_WGSL,
    ...[CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS].flatMap(({ bloom }) => Object.values(bloom)),
  ]
  for (const source of texts) {
    assert.equal(
      functionsOf(source, ['tent']).match(
        /if\(x\.weight\.[xyz]>0\.0&&y\.weight\.[xyz]>0\.0\)\{c\+=fetchLevel\(/g,
      )?.length,
      9,
    )
    assert.match(
      functionsOf(source, ['fetchLevel']),
      /textureSampleLevel\(level,linearClamp,uv,0\.0\)/,
    )
  }
})
