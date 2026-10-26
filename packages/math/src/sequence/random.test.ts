// random.ts: each step against the same generator in exact BigInt arithmetic, the Rust crate's own
// cases (random_tests.rs), and the closures as the bench, the kit and the blue noise wrote them. The seeded
// masks made from them (`voidAndCluster.ts`, `vectorAnnealing.ts`, `noiseField.ts`) are tested here too.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lcgRandom, mulberry32, xorshiftRandom } from './random.ts'
import { energyWeights, rankByte, volumeAddress } from './noiseEnergy.ts'
import { buildTree, createField, extremum, flip, refresh } from './noiseField.ts'
import { bandMean, spatialSpectrum, temporalSpectrum } from './noiseSpectrum.fixture.ts'
import { ANNEALING_DEFAULTS, annealVectors } from './vectorAnnealing.ts'
import { voidAndCluster } from './voidAndCluster.ts'
import {
  lcgFloatRandom,
  lcgFloatWord,
  lcgImulRandom,
  lcgImulWord,
  lcgMaskedRandom,
} from './seeded.fixture.ts'
import { GOLDEN_U32 } from '../constants.ts'

const W = 2n ** 32n
const MASK = W - 1n

/** One xorshift (13, 17, 5) step on a BigInt word. */
const xorshiftBig = (x: bigint) => {
  x = (x ^ (x << 13n)) & MASK
  x ^= x >> 17n
  return (x ^ (x << 5n)) & MASK
}
/** `Math.imul` as a product modulo 2³², signed read back as a BigInt word. */
const mulBig = (a: bigint, b: bigint) => (a * b) & MASK
const mulberryBig = (s: bigint) => {
  let v = mulBig(s ^ (s >> 15n), s | 1n)
  v = (v ^ ((v + mulBig(v ^ (v >> 7n), v | 61n)) & MASK)) & MASK
  return v ^ (v >> 14n)
}

test('xorshift32 steps by 13, 17, 5 on the word, as the Rust crate does', () => {
  // A draw is the stepped word over 2³², exact: times 2³² it is the word.
  const draw = xorshiftRandom(0x2545f491)
  let big = 0x2545f491n
  for (let i = 0; i < 1000; i++) {
    big = xorshiftBig(big)
    assert.equal(draw() * 2 ** 32, Number(big), `${i}`)
  }
  assert.equal(xorshiftRandom(0)(), xorshiftRandom(GOLDEN_U32)())
})

test('lcg32 is x·1664525 + 1013904223 modulo 2³²', () => {
  assert.equal(lcgRandom(957)() * 2 ** 32, (957 * 1664525 + 1013904223) % 2 ** 32)
  assert.equal(lcgRandom(0)() * 2 ** 32, 1013904223)
  const draw = lcgRandom(0xdeadbeef)
  let big = 0xdeadbeefn
  for (let i = 0; i < 1000; i++) {
    big = (big * 1664525n + 1013904223n) % W
    assert.equal(draw() * 2 ** 32, Number(big), `${i}`)
  }
})

test('mulberry32: the step and the mix, against BigInt words', () => {
  let s = 12345n
  const draw = mulberry32(12345)
  for (let i = 0; i < 1000; i++) {
    s = (s + 0x6d2b79f5n) % W
    assert.equal(draw(), Number(mulberryBig(s)) / 2 ** 32, `${i}`)
  }
})

test('the closures draw in [0, 1) as the bench, the kit and the blue noise wrote them', () => {
  // The bench's xorshiftRandom, the kit's seeded and mulberry32, written out once more here.
  const bench = (depart: number) => {
    let state = depart >>> 0 || 0x9e3779b9
    return () => {
      state = (state ^ (state << 13)) >>> 0
      state = (state ^ (state >>> 17)) >>> 0
      state = (state ^ (state << 5)) >>> 0
      return state / 4294967296
    }
  }
  const seeded = (seed: number) => {
    let state = seed >>> 0
    return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
  }
  const prng = (seed: number) => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  for (const seed of [0, 1, 7, 0x9e3779b9, 2 ** 31, 2 ** 32 - 1, -5]) {
    const pairs = [
      [xorshiftRandom(seed), bench(seed)],
      [lcgRandom(seed), seeded(seed)],
      [mulberry32(seed), prng(seed)],
    ]
    for (const [mine, theirs] of pairs)
      for (let i = 0; i < 500; i++) {
        const value = mine()
        assert.equal(value, theirs(), `${seed} ${i}`)
        assert.ok(value >= 0 && value < 1)
      }
  }
})

test('the 1103515245 streams are the closures the fixtures wrote, bit for bit', () => {
  for (const seed of [0, 1, 7, 831, 20260915, 2 ** 31 + 5, 2 ** 32 - 1]) {
    // The old bodies, each with its own state: wrapped imul, doubles (rounding past 2^53), masked.
    let imul = seed >>> 0,
      float = seed,
      masked = seed
    const imulWord = lcgImulWord(seed),
      imulRandom = lcgImulRandom(seed),
      floatWord = lcgFloatWord(seed),
      floatRandom = lcgFloatRandom(seed),
      maskedRandom = lcgMaskedRandom(seed)
    let imul2 = imul,
      float2 = float
    for (let i = 0; i < 500; i++) {
      const at = `${seed} ${i}`
      assert.equal(imulWord(), (imul = (Math.imul(imul, 1103515245) + 12345) >>> 0), at)
      assert.equal(
        imulRandom(),
        (imul2 = (Math.imul(imul2, 1103515245) + 12345) >>> 0) / 2 ** 32,
        at,
      )
      assert.equal(floatWord(), (float = (float * 1103515245 + 12345) >>> 0), at)
      assert.equal(floatRandom(), (float2 = (float2 * 1103515245 + 12345) >>> 0) / 4294967296, at)
      assert.equal(
        maskedRandom(),
        (masked = (masked * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff,
        at,
      )
    }
  }
})

test("a mask's energy weights are the method's: each axis cut where a Gaussian has lost half a percent, normalised, no offset naming a pixel twice", () => {
  const sigma = 1.9
  const beyond = (reach: number) =>
    Array.from({ length: reach }, (_, d) => Math.exp(-((d + 1) ** 2) / (2 * sigma * sigma)))
  const axisWeights = (size: number, sigma: number, centre: boolean) =>
    energyWeights({ width: size, height: size, depth: size }, sigma, centre).x
  const wide = axisWeights(128, sigma, false)
  assert.deepEqual(
    [wide.from, wide.to, wide.weights.length],
    [-6, 6, 7],
    'a reach of six: 6.18 floors',
  )
  const sum = beyond(6).reduce((a, b) => a + b, 0)
  assert.ok(
    Math.abs(wide.weights[0] - 1 / sum) < 1e-6,
    'the centre weighs the first of the others over the sum of them',
  )
  assert.ok(Math.abs(wide.weights[1] / wide.weights[0] - Math.exp(-1 / (2 * sigma * sigma))) < 1e-6)
  assert.ok(
    Math.abs(axisWeights(128, sigma, true).weights[0] - 1 / (1 + sum)) < 1e-6,
    'summed with the centre',
  )
  // An axis the cut is wider than reaches a pixel less on one side: its offsets are its pixels, each once.
  const small = axisWeights(8, sigma, false)
  assert.deepEqual([small.from, small.to], [-3, 4])
  assert.equal(small.to - small.from + 1, 8)
  assert.throws(() => volumeAddress({ width: 12, height: 16, depth: 8 }), RangeError)
  assert.deepEqual([rankByte(0, 1024), rankByte(1023, 1024), rankByte(512, 1024)], [0, 255, 128])
})

/** The first pixel of the energies `energy` that is on (`wanted` 1) with the most of them, or off (0) with the least. */
function scanned(energy: Float32Array, on: Uint8Array, wanted: 0 | 1) {
  let best = -1
  for (let pixel = 0; pixel < energy.length; pixel++) {
    if (on[pixel] !== wanted) continue
    const better =
      best < 0 || (wanted === 1 ? energy[pixel] > energy[best] : energy[pixel] < energy[best])
    if (better) best = pixel
  }
  return best
}

test('the tournament over a field finds the pixel a scan of the field in index order finds, ties to the first, through a run of flips', () => {
  const field = createField({ width: 16, height: 16, depth: 8 }, 1.9)
  const draw = mulberry32(99)
  const flipRandom = () => {
    const pixel = Math.floor(draw() * field.address.count)
    flip(field, pixel, !field.on[pixel])
  }
  for (let k = 0; k < 300; k++) flipRandom()
  refresh(field, [])
  const trees = [buildTree(field, 'cluster'), buildTree(field, 'void')]
  for (let k = 0; k < 400; k++) {
    flipRandom()
    refresh(field, trees)
    assert.equal(extremum(trees[0]), scanned(field.energy, field.on, 1), `cluster after ${k}`)
    assert.equal(extremum(trees[1]), scanned(field.energy, field.on, 0), `void after ${k}`)
  }
  // Every pixel off and none on: no cluster, and the void is the first of the pixels that tie.
  const empty = createField({ width: 16, height: 16, depth: 8 }, 1.9)
  assert.equal(extremum(buildTree(empty, 'cluster')), -1)
  assert.equal(extremum(buildTree(empty, 'void')), 0)
})

const SMALL = { width: 32, height: 32, depth: 16 } as const

test('void and cluster ranks every pixel once, the same on every run, blue in every image and along the frames', () => {
  const ranks = voidAndCluster(SMALL)
  assert.deepEqual(voidAndCluster(SMALL), ranks, 'the same on every run')
  const seen = new Uint8Array(ranks.length)
  for (const rank of ranks) seen[rank]++
  assert.ok(
    seen.every((count) => count === 1),
    'each rank once',
  )
  const bytes = Uint8Array.from(ranks, (rank) => rankByte(rank, ranks.length))
  const space = spatialSpectrum(bytes, 32, [0, 3, 6, 9, 12, 15])
  const time = temporalSpectrum(bytes, 32, 16, 2)
  assert.ok(bandMean(space, 1, 4) < 0.1, `the lowest spatial frequencies: ${bandMean(space, 1, 4)}`)
  assert.ok(bandMean(space, 13, 16) > 1.05, `the highest: ${bandMean(space, 13, 16)}`)
  assert.ok(bandMean(time, 1, 2) < 0.15, `the lowest temporal frequencies: ${bandMean(time, 1, 2)}`)
  assert.ok(bandMean(time, 6, 8) > 1.1, `the highest: ${bandMean(time, 6, 8)}`)
  // The ranks of a random mask would hold white noise's power at every frequency.
  const draw = mulberry32(5)
  const white = Uint8Array.from(ranks, () => Math.floor(draw() * 256))
  assert.ok(bandMean(spatialSpectrum(white, 32, [0, 3, 6, 9, 12, 15]), 1, 4) > 0.5)
})

/** The energy of a mask of vectors `cells` (two values a pixel), by every pixel's every neighbour: the mask's weights over
 *  `exp(−d^(2/3) / 2σᵥ²)` of the pair's distance, in each image and along each pixel's frames. */
function maskEnergy(cells: Float32Array, volume: typeof SMALL) {
  const { x, y, z } = energyWeights(volume, ANNEALING_DEFAULTS.sigma, true)
  const a = volumeAddress(volume)
  let total = 0
  const pair = (p: number, q: number) => {
    const d = Math.abs(cells[2 * p] - cells[2 * q]) + Math.abs(cells[2 * p + 1] - cells[2 * q + 1])
    return Math.exp(-Math.pow(d, 2 / 3) / 2)
  }
  for (let p = 0; p < a.count; p++) {
    const [px, py, pz] = [p & a.xMask, (p >> a.yShift) & a.yMask, p >> a.zShift]
    for (let dy = y.from; dy <= y.to; dy++)
      for (let dx = x.from; dx <= x.to; dx++) {
        if (dx === 0 && dy === 0) continue
        const q = (pz << a.zShift) + (((py + dy) & a.yMask) << a.yShift) + ((px + dx) & a.xMask)
        total += x.weights[Math.abs(dx)] * y.weights[Math.abs(dy)] * pair(p, q)
      }
    for (let dz = z.from; dz <= z.to; dz++) {
      if (dz === 0) continue
      const q = (((pz + dz) & a.zMask) << a.zShift) + (p & ((1 << a.zShift) - 1))
      total += z.weights[Math.abs(dz)] * pair(p, q)
    }
  }
  return total
}

test('annealing swaps vectors and never makes one, and ends with less energy than it began with, bluer in space and in time', () => {
  const count = 32 * 32 * 16
  const options = { ...ANNEALING_DEFAULTS, swapCountFactor: 40 / count, coolingFactor: 0.4 / count }
  const first = (() => {
    const random = mulberry32(options.seed)
    return Float32Array.from({ length: count * 2 }, () => random())
  })()
  const cells = annealVectors(SMALL, options)
  const sorted = (values: Float32Array) =>
    Array.from(values.filter((_, i) => i % 2 === 0)).sort((a, b) => a - b)
  assert.deepEqual(sorted(cells), sorted(first), 'the same first values, moved')
  assert.ok(maskEnergy(cells, SMALL) < 0.985 * maskEnergy(first, SMALL), 'the energy fell')
  const channel = (values: Float32Array) =>
    Float32Array.from({ length: count }, (_, i) => values[2 * i] * 255)
  const frames = [0, 3, 6, 9, 12, 15]
  const before = bandMean(spatialSpectrum(channel(first), 32, frames), 1, 4)
  const after = bandMean(spatialSpectrum(channel(cells), 32, frames), 1, 4)
  assert.ok(after < 0.4 * before, `the lowest spatial frequencies fell: ${before} to ${after}`)
  assert.ok(
    bandMean(temporalSpectrum(channel(cells), 32, 16, 2), 1, 2) < 0.6,
    'and the temporal ones',
  )
})
