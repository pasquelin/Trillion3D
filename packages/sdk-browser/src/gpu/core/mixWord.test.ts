// The one word hash (`mixWord`): the processor's twin follows the shipped WGSL word for word, and
// the salt every second coordinate of a hash takes (`GOLDEN_U32`) decorrelates as the odd constant
// the temporal pass took before. The other words the passes keep their values in are tested here too: the
// 11-11-10 small floats (`smallFloatWgsl.ts`) and the dither that rounds them, and the workgroup's sort and sum they
// are ordered and reduced by (`workgroupSortWgsl.ts`, `workgroupSumWgsl.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { GOLDEN_U32 } from '../../../../math/src/constants.ts'
import { mixWord as mixWordWgsl } from '../../../../math/src/wgsl/sampling.ts'
import { mixWord } from '../../../../math/src/scalar/integers.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { cpuHashUnit, hashUnit } from '../../../../math/src/scalar/hashUnit.fixture.ts'
import { ditherLight, packLight, unpackLight } from './smallFloatWgsl.ts'
import { workgroupSortWgsl } from './workgroupSortWgsl.ts'
import { workgroupSumLoop } from './workgroupSumWgsl.ts'

/** The reference, in big integers: the definition of the hash without a wrapped product. */
const mixBig = (x: number) => {
  const M = 0xffffffffn
  let h = (BigInt(x) * 0x9e3779b1n) & M
  h ^= h >> 15n
  h = (h * 0x85ebca77n) & M
  h ^= h >> 13n
  return Number(h)
}

test('the processor twin of mixWord is the definition, on the edges and on a spread of words', () => {
  const words = [0, 1, 2, 0x7fffffff, 0x80000000, 0xffffffff, GOLDEN_U32]
  const draw = lcgRandom(12345)
  for (let i = 0; i < 4096; i++) words.push(draw() * 2 ** 32)
  for (const x of words) assert.equal(mixWord(x), mixBig(x), `word ${x}`)
})

test('the shipped WGSL mixWord evaluates to the twin', () => {
  const { mixWord: run } = shaderRun<{ mixWord: (x: number) => number }>(
    wgslModule(mixWordWgsl),
    ['mixWord'],
    {
      $b: (op: string, a: number, b: number) =>
        op === '*'
          ? Math.imul(a, b) >>> 0
          : op === '>>'
            ? a >>> b
            : op === '^'
              ? (a ^ b) >>> 0
              : NaN,
    },
  )
  const draw = lcgRandom(7)
  for (let i = 0; i < 512; i++) {
    const x = draw() * 2 ** 32
    assert.equal(run(x), mixWord(x), `word ${x}`)
  }
})

test('the shipped WGSL hashUnit evaluates to its processor twin', () => {
  const { hashUnit: run } = shaderRun<{ hashUnit: (x: number) => number }>(
    wgslModule(hashUnit),
    ['hashUnit'],
    {
      $b: (op: string, a: number, b: number) =>
        op === '*'
          ? Number.isInteger(a) && Number.isInteger(b)
            ? Math.imul(a, b) >>> 0
            : Math.fround(Math.fround(a) * Math.fround(b))
          : op === '+'
            ? (a + b) >>> 0
            : op === '>>'
              ? a >>> b
              : op === '^'
                ? (a ^ b) >>> 0
                : NaN,
      f32: (x: number) => Math.fround(x),
    },
  )
  const draw = lcgRandom(31)
  for (const seed of [0, 1, 0xffffffff, ...Array.from({ length: 512 }, () => draw() * 2 ** 32)])
    assert.equal(run(seed >>> 0), cpuHashUnit(seed), `seed ${seed}`)
})

test('the golden salt decorrelates the temporal pass second coordinate as the constant it replaces', () => {
  assert.ok(hashUnit.text.includes('747796405u'), 'the hash measured is the shipped one')
  const measure = (salt: number) => {
    const n = 1 << 20,
      bins = new Array<number>(64).fill(0)
    let sa = 0,
      sb = 0,
      saa = 0,
      sbb = 0,
      sab = 0
    for (let p = 0; p < n; p++) {
      const seed = (((p >>> 10) * 65536 + (p & 1023)) * 8 + 3) >>> 0
      const a = cpuHashUnit(seed),
        b = cpuHashUnit((seed ^ salt) >>> 0)
      sa += a
      sb += b
      saa += a * a
      sbb += b * b
      sab += a * b
      bins[Math.floor(a * 8) * 8 + Math.floor(b * 8)]++
    }
    const ma = sa / n,
      mb = sb / n
    const r = (sab / n - ma * mb) / Math.sqrt((saa / n - ma * ma) * (sbb / n - mb * mb))
    const chi = bins.reduce((sum, c) => sum + (c - n / 64) ** 2 / (n / 64), 0)
    return { r, chi }
  }
  for (const salt of [0x5bd1e995, GOLDEN_U32]) {
    const { r, chi } = measure(salt)
    // Independent coordinates: the correlation within four standard errors of zero, and the 8×8
    // joint histogram's chi-square (63 degrees of freedom) within its 0.1% tails.
    assert.ok(Math.abs(r) < 4 / Math.sqrt(1 << 20), `correlation ${r} for ${salt.toString(16)}`)
    assert.ok(chi > 37 && chi < 103, `chi-square ${chi} for ${salt.toString(16)}`)
  }
})

test("a colour packs into the 11-11-10 word to the format's precision, and is held to its range, never negative", () => {
  const { packLight: pack, unpackLight: unpack } = shaderRun<{
    packLight: (c: number[]) => number
    unpackLight: (w: number) => number[]
  }>(wgslModule(packLight, unpackLight), ['packLight', 'unpackLight'], {})
  for (const c of [
    [0.5, 0.25, 0.125],
    [3.7, 12.25, 0.9],
    [1000, 40, 0.001],
    [65000, 1, 64000],
  ]) {
    const back = unpack(pack(c))
    // Six bits of mantissa a channel (five on the last): within 1/64 of itself (1/32).
    back.forEach((v, i) =>
      assert.ok(Math.abs(v - c[i]) <= c[i] / (i === 2 ? 32 : 64) + 1e-9, `${c} -> ${back}`),
    )
  }
  assert.deepEqual(unpack(pack([0, 0, 0])), [0, 0, 0])
  assert.deepEqual(unpack(pack([-1, -5, -0.5])), [0, 0, 0], 'a negative channel is none')
  assert.deepEqual(
    unpack(pack([1e9, 1e9, 1e9])),
    [65024, 65024, 64512],
    "held to the format's largest",
  )
  assert.equal(pack([1, 0, 0]) >>> 11, 0, 'the first channel is in the low bits')
})

test('the workgroup sort orders entries by their f32 key and, for one key, by their x descending: the network on any count of a power of two', () => {
  const sorted = (keys: number[]) => {
    const count = keys.length
    const view = new DataView(new ArrayBuffer(4))
    const bits = (key: number) => (view.setFloat32(0, key), view.getUint32(0))
    const rays = keys.map((key, x) => [x, bits(key)])
    const sort = shaderRun<{ raysStep: (lane: number, k: number, j: number) => void }>(
      wgslModule(workgroupSortWgsl('rays', count)),
      ['raysStep'],
      { rays },
    )
    // Every thread of a step, the steps in the network's order: a compare-exchange touches a pair, so the lanes of a step are independent.
    for (let k = 2; k <= count; k <<= 1)
      for (let j = k >> 1; j > 0; j >>= 1)
        for (let lane = 0; lane < count; lane++) sort.raysStep(lane, k, j)
    return rays.map(([x, y]) => [x, y])
  }
  const lcg = lcgRandom(5)
  for (const count of [4, 16, 64]) {
    const keys = Array.from({ length: count }, () => Math.fround(Math.floor(lcg() * 6) / 4))
    const out = sorted(keys)
    const expected = keys
      .map((key, x) => [x, key])
      .sort((a, b) => a[1] - b[1] || b[0] - a[0])
      .map(([x]) => x)
    assert.deepEqual(
      out.map(([x]) => x),
      expected,
      `${count} entries, ties by x descending`,
    )
  }
  assert.throws(() => workgroupSortWgsl('rays', 12), RangeError)
})

test('the workgroup sum halves a power of two: the loop is the barriered one, and a width that is not is refused', () => {
  const text = workgroupSumLoop(64, 'sums[lane]+=sums[lane+stride];')
  assert.ok(text.includes('stride=32u'), 'half the group, first')
  assert.equal(
    text.split('workgroupBarrier()').length - 1,
    2,
    'one before each step, one after the last',
  )
  assert.ok(workgroupSumLoop('SP_RAYS', 'x').includes('(SP_RAYS)/2u'), 'a width the shader names')
  for (const bad of [0, 1, 12, 2.5]) assert.throws(() => workgroupSumLoop(bad, 'x'), RangeError)
})

test('a colour dithered before it is packed rounds up or down with the odds that make it right on average: a light blended into itself does not drift', () => {
  const run = shaderRun<{
    packLight: (c: number[]) => number
    unpackLight: (w: number) => number[]
    ditherLight: (c: number[], e: number) => number[]
  }>(
    wgslModule(packLight, unpackLight, ditherLight),
    ['packLight', 'unpackLight', 'ditherLight'],
    {},
  )
  // A third of a step above a number the format holds, in each channel: nearest rounding always goes down.
  const colour = [1 + 0.3 / 64, 4 + 4 * (0.3 / 64), 0.5 + 0.5 * (0.3 / 32)]
  const mean = [0, 0, 0]
  const draws = 1024
  for (let k = 0; k < draws; k++) {
    const back = run.unpackLight(run.packLight(run.ditherLight(colour, (k + 0.5) / draws)))
    back.forEach((value, i) => (mean[i] += value / draws))
  }
  const plain = run.unpackLight(run.packLight(colour))
  colour.forEach((value, i) => {
    const step = i === 2 ? 0.5 / 32 : value > 2 ? 4 / 64 : 1 / 64
    assert.ok(Math.abs(mean[i] - value) < step / 100, `channel ${i}: ${mean[i]} for ${value}`)
    assert.ok(Math.abs(plain[i] - value) > step / 5, `without it channel ${i} is ${plain[i]}`)
  })
  assert.deepEqual(run.ditherLight([0, 0, 0], 0.9), [0, 0, 0], 'none stays none')
})
