// The one word hash (`mixWord`): the processor's twin follows the shipped WGSL word for word, and
// the salt every second coordinate of a hash takes (`GOLDEN_U32`) decorrelates as the odd constant
// the temporal pass took before.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { GOLDEN_U32 } from '../../../../math/src/constants.ts'
import { hashUnit, mixWord as mixWordWgsl } from '../../../../math/src/wgsl/sampling.ts'
import { mixWord } from '../../../../math/src/scalar/integers.ts'

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
  for (let i = 0, x = 12345; i < 4096; i++, x = (Math.imul(x, 1664525) + 1013904223) >>> 0)
    words.push(x)
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
  for (let i = 0, x = 7; i < 512; i++, x = (Math.imul(x, 1664525) + 1013904223) >>> 0)
    assert.equal(run(x), mixWord(x), `word ${x}`)
})

/** The shipped `hashUnit`, in integers. */
const unit = (seed: number) => {
  let x = (Math.imul(seed, 747796405) + 2891336453) >>> 0
  x = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0
  x = ((x >>> 22) ^ x) >>> 0
  return Math.fround(x * 2.3283064e-10)
}

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
      const a = unit(seed),
        b = unit((seed ^ salt) >>> 0)
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
