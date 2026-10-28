// A texture read with ONE read (`virtualTextureAnisotropicFiltering` off, the default): the level of the
// longer axis moved toward the shorter by the elongation up to the logarithm of the grant, plus the
// pixel's noise, floored — one whole level, the request's too; with the taps on, the taps as ever.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Texture } from '../../../../../sdk-core/src/texture/contract.ts'
import {
  SAMPLE_ANISOTROPY_SHIFT,
  SAMPLE_ONE_READ,
  SAMPLE_SLOT_MASK,
  SAMPLE_WRAP_SHIFT,
  samplingWords,
} from '../../texture/sampling.ts'
import { TILE_POOL_WGSL } from '../wgsl.ts'
import { tileKindWgsl } from '../kindWgsl.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'

const FOOTPRINT = wgslSource(TILE_POOL_WGSL)
const record = (fields: Partial<Texture> = {}) =>
  ({
    wrapS: 'repeat',
    wrapT: 'repeat',
    magFilter: 'linear',
    minFilter: 'linearMipLinear',
    anisotropy: 8,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ...fields,
  }) as Texture

/** The shader's own lines of `tileRead` for the one read, run on the CPU from `raw` = 5, the level
 *  of the longer axis: WGSL's calls read as `Math`'s, `firstLeadingBit` as the top bit's index. */
function oneRead(lx: number, ly: number, granted: number, noise: number, last = 12) {
  const line = (name: string) => {
    const found = FOOTPRINT.match(new RegExp(`${name}([^;]+);`))
    assert.ok(found, name)
    return found[1]
      .replace(/\b(min|max|log2|floor)\(/g, 'Math.$1(')
      .replace(/\bf32\(/g, '(')
      .replace(/\bfirstLeadingBit\(/g, 'topBit(')
  }
  return new Function(
    'lx',
    'ly',
    'granted',
    'tileNoise',
    'last',
    'DIVISOR_FLOOR',
    `const topBit=(x)=>31-Math.clz32(x),clamp=(x,a,b)=>Math.min(Math.max(x,a),b);
     let raw=5;const elongation=${line('let elongation=')};raw-=${line('raw-=(?=min)')};
     return clamp(Math.floor(raw+tileNoise),0,last);`,
  )(lx, ly, granted, noise, last, wgslConstants(FOOTPRINT).DIVISOR_FLOOR) as number
}

test('one read: the level of the longer axis moved by the elongation, up to the grant’s logarithm', () => {
  // The lengths are squared: 16 is an elongation of 2.
  assert.equal(oneRead(16, 1, 8, 0), 3, 'two levels lower')
  assert.equal(oneRead(16, 1, 8, 0.99), 3, 'a noise below one level stays on it')
  // An elongation of 4 (256) is held to the grant’s logarithm: 3 for 8, 2 for 4, 0 for 1.
  assert.equal(oneRead(256, 1, 8, 0), 2)
  assert.equal(oneRead(256, 1, 4, 0), 3)
  assert.equal(oneRead(256, 1, 1, 0), 5, 'a grant of 1: the longer axis’ level')
  assert.equal(oneRead(1, 1, 8, 0.5), 5, 'face-on: the level itself')
})

test('one read: the noise picks the level above the fraction’s share, 0.5 rounding to the nearest', () => {
  // An elongation of 1.5 (8): the level is 3.5.
  const seen = [0, 0.25, 0.49, 0.5, 0.75, 0.99].map((noise) => oneRead(8, 1, 8, noise))
  assert.deepEqual(seen, [3, 3, 3, 4, 4, 4])
})

test('one read: the level stays within the texture’s levels', () => {
  assert.equal(oneRead(1, 1, 8, 0.99, 3), 3, 'past the last level: the last')
})

test('the word carries the one read above the addressing nibble, outside the zero test', () => {
  const taps = [...samplingWords(record(), 8, true)],
    once = [...samplingWords(record(), 8, false)]
  const filter = (1 << SAMPLE_WRAP_SHIFT) - 1
  assert.equal(taps[0] & SAMPLE_ONE_READ, 0)
  assert.equal(once[0] & SAMPLE_ONE_READ, SAMPLE_ONE_READ)
  assert.equal(once[0] & filter, taps[0] & filter)
  assert.equal(
    ((once[0] >>> SAMPLE_ANISOTROPY_SHIFT) & 15) + 1,
    8,
    'the grant is kept for the level',
  )
  assert.equal(samplingWords(record({ anisotropy: 1 }), 8, false)[0] & filter, 0)
})

test('a slot carries the one read with its filter and the addressing nibble alone as the wrap', () => {
  const slot = wgslSource(tileKindWgsl('color', TILE_POOL_WGSL))
  assert.ok(slot.includes(`word&${SAMPLE_SLOT_MASK}u,(word>>${SAMPLE_WRAP_SHIFT}u)&15u`))
})

test('the taps keep their rule when on, and the one read names a whole level the request takes as is', () => {
  assert.match(FOOTPRINT, /if\(\(s\.sampling&\d+u\)==0u\)\{\n\s+if\(granted>1u\)\{/)
  assert.match(
    FOOTPRINT,
    /if\(single\)\{lod=clamp\(floor\(raw\+tileNoise\),0\.0,f32\(s\.last\)\);\}/,
  )
})

test('a texture at the default read is still read through the filter rule while it is read once', () => {
  const words = (taps: boolean) => samplingWords(record({ anisotropy: 1 }), 8, taps)[0]
  const sampled = (word: number) => ((word >>> 0) & SAMPLE_SLOT_MASK) !== 0
  assert.equal(sampled(words(true)), false, 'with taps, the default read as before')
  assert.equal(sampled(words(false)), true, 'once: the reference’s rule, no trilinear mix')
})
