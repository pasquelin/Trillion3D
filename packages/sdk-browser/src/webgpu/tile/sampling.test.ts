import test from 'node:test'
import assert from 'node:assert/strict'
import type { Texture } from '../../../../sdk-core/src/index.ts'
import {
  SAMPLE_ANISOTROPY_SHIFT,
  SAMPLE_MAG_NEAREST,
  SAMPLE_MIN_NEAREST,
  SAMPLE_MIP_NEAREST,
  SAMPLE_TRANSFORMED,
  SAMPLE_WRAP_SHIFT,
  samplingWords,
} from '../../texture/sampling.ts'
import { SAMPLING_WGSL, atlasReadWgsl } from './samplingWgsl.ts'
import { maskAlphaWgsl } from './wgsl.ts'
import { MAX_ANISOTROPY } from '../../texture/maxAnisotropy.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** An engine texture record with the default sampling, `fields` written over it. */
const record = (fields: Partial<Texture> = {}) =>
  ({
    wrapS: 'clamp',
    wrapT: 'clamp',
    magFilter: 'linear',
    minFilter: 'linear-mip-linear',
    anisotropy: 1,
    transform: IDENTITY,
    ...fields,
  }) as Texture

/** The filter word of a texture. */
const filterOf = (fields: Partial<Texture>) => samplingWords(record(fields))[0]

test('the default sampling is the zero word: the read the pools had before', () => {
  assert.deepEqual([...samplingWords(record())], [0, 0x3f800000, 0, 0, 0x3f800000, 0, 0])
})

// #360, #361: the addressing rides above the filter bits, outside the zero test: a repeating
// texture at the default filters keeps the default read.
test('the addressing nibble sits above the filter bits', () => {
  const word = filterOf({ wrapS: 'repeat', wrapT: 'mirror' })
  assert.equal(word, (1 | 8) << SAMPLE_WRAP_SHIFT)
  assert.equal(word & ((1 << SAMPLE_WRAP_SHIFT) - 1), 0, 'the default read')
})

test('each filter name sets its base filter and mip rule', () => {
  assert.equal(filterOf({ magFilter: 'nearest' }), SAMPLE_MAG_NEAREST)
  assert.equal(filterOf({ minFilter: 'nearest' }), SAMPLE_MIN_NEAREST)
  assert.equal(
    filterOf({ minFilter: 'nearest-mip-nearest', magFilter: 'nearest' }),
    SAMPLE_MAG_NEAREST | SAMPLE_MIN_NEAREST | SAMPLE_MIP_NEAREST,
  )
  assert.equal(
    filterOf({ minFilter: 'nearest-mip-linear', magFilter: 'nearest' }),
    SAMPLE_MAG_NEAREST | SAMPLE_MIN_NEAREST,
  )
  assert.equal(filterOf({ minFilter: 'linear-mip-nearest' }), SAMPLE_MIP_NEAREST)
})

// A filter without `mip` picks the read inside a level, never the level: every texture — the
// cache's chain or the one the GPU builds for a page texture — reads its footprint's level, so a
// far surface reads a coarse level instead of aliasing level 0, and its tile requests follow.
test('a filter without mip reads the footprint level, as the default read does', () => {
  assert.equal(filterOf({ minFilter: 'linear' }), 0, 'the default read')
  assert.equal(filterOf({ minFilter: 'nearest' }), SAMPLE_MIN_NEAREST)
  assert.doesNotMatch(wgslSource(SAMPLING_WGSL), /lod=0\.0/)
  assert.match(wgslSource(SAMPLING_WGSL), /var lod=clamp\(raw,0\.0,f32\(s\.last\)\);/)
  assert.match(wgslSource(SAMPLING_WGSL), /if\(\(s\.sampling&4u\)!=0u\)\{lod=floor\(lod\+0\.5\);\}/)
})

// WebGPU's switch between magnification and minification: at level 0 for every filter. Under the
// switch, level 0 with the magnification filter.
test('minification starts past level 0 whatever the mip rule', () => {
  assert.match(wgslSource(SAMPLING_WGSL), /let mag=raw<=0\.0;/)
  assert.match(wgslSource(SAMPLING_WGSL), /select\(2u,1u,mag\)/)
})

// The grant: a linear magnification over a chain mixed across levels — a filter without `mip`
// included —, or nothing; clamped to WebGPU's ceiling.
test('anisotropy is clamped to the ceiling, and granted only to a linear read mixed across levels', () => {
  const granted = (word: number) => ((word >> SAMPLE_ANISOTROPY_SHIFT) & 15) + 1
  assert.equal(granted(filterOf({ anisotropy: 8 })), 8)
  assert.equal(granted(filterOf({ anisotropy: 64 })), MAX_ANISOTROPY)
  assert.equal(granted(filterOf({ anisotropy: 0 })), 1)
  assert.equal(granted(filterOf({ anisotropy: 16, minFilter: 'nearest-mip-linear' })), 16)
  assert.equal(granted(filterOf({ anisotropy: 16, minFilter: 'linear' })), 16)
  assert.equal(granted(filterOf({ anisotropy: 16, magFilter: 'nearest' })), 1)
  assert.equal(granted(filterOf({ anisotropy: 16, minFilter: 'linear-mip-nearest' })), 1)
  assert.equal(filterOf({ anisotropy: 16 }) & SAMPLE_TRANSFORMED, 0, 'below the transform bit')
})

// #360, #361: the shadow cutout reads one tap at the isotropic level; the camera cutout reads the
// alpha of the colour's own read, the taps its footprint's elongation asks.
test('the shadow cutout takes one tap, the camera cutout the colour read and its taps', () => {
  const shaded = atlasReadWgsl('colorSample', 'color', 'vec4f', true).text,
    shadow = wgslModule(maskAlphaWgsl(true))
  assert.match(shaded, /colorFootprint\(slot,s,uv,ddx,ddy,true\)/)
  assert.match(shaded, /if\(r\.taps>1u\)\{return colorSampleTaps\(s,r\);\}/)
  assert.match(shadow, /colorFootprint\(slot,s,uv,ddx,ddy,false\)/)
  assert.doesNotMatch(shadow, /taps/i)
  assert.equal(
    maskAlphaWgsl(false).text,
    'fn maskAlpha(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f,sampled:bool)->f32{return colorSample(slot,uv,ddx,ddy,sampled).w;}',
  )
})

/** The shader's own ratio, taps and level lines, run on the CPU — the taps, and how many levels
 *  the read is lowered: WGSL's calls read as `Math`'s, `u32` as a truncation, the `u` of an
 *  unsigned literal dropped, `select` a ternary. */
const readOf = (lx: number, ly: number, granted: number) => {
  const line = (name: string) => {
    const found = wgslSource(SAMPLING_WGSL).match(new RegExp(`${name}=([^;]+);`))
    assert.ok(found, name)
    return found[1]
      .replace(/\b(min|max|sqrt|ceil|log2)\(/g, 'Math.$1(')
      .replace(/\bu32\(/g, 'Math.trunc(')
      .replace(/\bf32\(/g, '(')
      .replace(/(\d)u\b/g, '$1')
  }
  return new Function(
    'lx',
    'ly',
    'granted',
    `const select=(f,t,c)=>c?t:f,ratio=${line('let ratio')},taps=${line('\\n\\s*taps')};return [taps,${line('raw-')}];`,
  )(lx, ly, granted) as [number, number]
}

// #443: the hardware's anisotropic rule: N taps, the ratio rounded up within the
// grant, at the level log2(Pmax / N) — 2.5 texels read with 3 taps log2(3) lower, not log2(2.5).
// A ratio within 0.01 of whole (`ANISOTROPY_SLACK`) reads as whole: face-on, one isotropic read.
test('an anisotropic read takes its ratio in taps, up to the grant, its level shared among them', () => {
  for (const [lx, ly, granted, taps] of [
    [16 * 16, 1, MAX_ANISOTROPY, 16],
    [1, 12 * 12, MAX_ANISOTROPY, 12],
    [1.005 * 1.005, 1, MAX_ANISOTROPY, 1],
    [64 * 64, 1, MAX_ANISOTROPY, 16],
    [16 * 16, 1, 4, 4],
    [2.5 * 2.5, 1, MAX_ANISOTROPY, 3],
    [3.005 * 3.005, 1, MAX_ANISOTROPY, 3],
    [12.5 * 12.5, 1, MAX_ANISOTROPY, 13],
    [4 * 4 * 1.000001, 1, MAX_ANISOTROPY, 4],
  ])
    assert.deepEqual(readOf(lx, ly, granted), [taps, Math.log2(taps)], `${lx} × ${ly} texels²`)
})

test('the affine part of the transform is carried, and flagged when it is not the identity', () => {
  // Repeat 4 × 2, offset (0.25, 0.5), a quarter turn: three columns of three.
  const transform = [0, -2, 0, 4, 0, 0, 0.25, 0.5, 1]
  const words = samplingWords(record({ transform }))
  assert.equal(words[0], SAMPLE_TRANSFORMED)
  assert.deepEqual([...new Float32Array(words.buffer, 4, 6)], [0, -2, 4, 0, 0.25, 0.5])
})

// #360, #361: a tap line that stays in one period, off its seams, is folded once and read one
// level at a time — a table entry once per tile —, the two levels mixed once; a line that meets
// a seam or leaves its period folds each tap alone, as a one-tap read does.
test('an anisotropic line is folded once when it stays in its period', () => {
  const shaded = atlasReadWgsl('colorSample', 'color', 'vec4f', true).text
  // The seam test reaches half a texel of the coarsest level read, whose seam is the widest.
  assert.match(
    shaded,
    /let line=foldLine\(r,s\.wrap,s\.size,levelSize\(s\.size,u32\(ceil\(r\.lod\)\)\)\);/,
  )
  assert.match(
    shaded,
    /if\(line\.dir\.x==0\.0\)\{[^}]*colorSampleAt\(s,r\.uv\+r\.axis\*tapOffset\(i,n\)/,
  )
  assert.match(shaded, /return mix\(a,colorLine\(s,line\.uv,step,n,u32\(l0\)\+1u,r\.nearest\),t\);/)
})
