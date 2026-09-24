import test from 'node:test';
import assert from 'node:assert/strict';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import {
  MAX_ANISOTROPY,
  SAMPLE_ANISOTROPY_SHIFT,
  SAMPLE_MAG_HALF,
  SAMPLE_MAG_NEAREST,
  SAMPLE_MIN_NEAREST,
  SAMPLE_MIP_NEAREST,
  SAMPLE_MIP_NONE,
  SAMPLE_TRANSFORMED,
  SAMPLE_WRAP_SHIFT,
  samplingWords,
} from './sampling.ts';
import { SAMPLING_WGSL, atlasReadWgsl } from './samplingWgsl.ts';
import { maskAlphaWgsl } from './wgsl.ts';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

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
  }) as Texture;

/** The filter word of a texture created in the page, or of one whose levels are the cache's. */
const filterOf = (fields: Partial<Texture>, compiled = false) =>
  samplingWords(record(fields), compiled)[0];

test('the default sampling is the zero word: the read the pools had before', () => {
  assert.deepEqual([...samplingWords(record(), false)], [0, 0x3f800000, 0, 0, 0x3f800000, 0, 0]);
  assert.equal(filterOf({}, true), 0);
});

// #360, #361: the addressing rides above the filter bits, outside the zero test: a repeating
// texture at the default filters keeps the default read.
test('the addressing nibble sits above the filter bits', () => {
  const word = filterOf({ wrapS: 'repeat', wrapT: 'mirror' });
  assert.equal(word, (1 | 8) << SAMPLE_WRAP_SHIFT);
  assert.equal(word & ((1 << SAMPLE_WRAP_SHIFT) - 1), 0, 'the default read');
});

test('each filter name sets its base filter and mip rule, on a texture created in the page', () => {
  assert.equal(filterOf({ magFilter: 'nearest' }), SAMPLE_MAG_NEAREST);
  assert.equal(filterOf({ minFilter: 'nearest' }), SAMPLE_MIN_NEAREST | SAMPLE_MIP_NONE);
  assert.equal(filterOf({ minFilter: 'linear' }), SAMPLE_MIP_NONE);
  assert.equal(
    filterOf({ minFilter: 'nearest-mip-nearest', magFilter: 'nearest' }),
    SAMPLE_MAG_NEAREST | SAMPLE_MIN_NEAREST | SAMPLE_MIP_NEAREST,
  );
  assert.equal(
    filterOf({ minFilter: 'nearest-mip-linear', magFilter: 'nearest' }),
    SAMPLE_MAG_NEAREST | SAMPLE_MIN_NEAREST,
  );
  assert.equal(filterOf({ minFilter: 'linear-mip-nearest' }), SAMPLE_MIP_NEAREST);
});

// #360, #361: GL's switch between magnification and minification (OpenGL ES 3.0 § 3.8.11): at
// level 0.5 for a linear magnification over a `nearest-mip-*` minification, at 0 otherwise. Under
// the switch, level 0 with the magnification filter.
test('minification starts at level 0.5 for a linear magnification over a nearest mip', () => {
  const half = (fields: Partial<Texture>) => (filterOf(fields) & SAMPLE_MAG_HALF) !== 0;
  assert.ok(half({ minFilter: 'nearest-mip-nearest' }));
  assert.ok(half({ minFilter: 'nearest-mip-linear' }));
  for (const fields of [
    { minFilter: 'nearest-mip-nearest', magFilter: 'nearest' },
    { minFilter: 'nearest' },
    { minFilter: 'linear-mip-nearest' },
    { minFilter: 'linear-mip-linear' },
  ] as const)
    assert.ok(!half(fields), JSON.stringify(fields));
  assert.match(SAMPLING_WGSL, /let mag=raw<=select\(0\.0,0\.5,\(s\.sampling&512u\)!=0u\);/);
  assert.match(SAMPLING_WGSL, /if\(mag\|\|\(s\.sampling&8u\)!=0u\)\{lod=0\.0;\}/);
  assert.match(SAMPLING_WGSL, /select\(2u,1u,mag\)/);
});

// #360, #361: a filter without `mip` on a texture of the compiled cache picks the read inside a
// level, never the level — the engine owns that chain, and its selection and tile requests stay
// those of the default read. On a texture created in the page, WebGL2's rule: level 0.
test('a filter without mip pins level 0 on a page texture, never on a compiled one', () => {
  assert.equal(filterOf({ minFilter: 'linear' }, true), 0, 'the default read');
  assert.equal(filterOf({ minFilter: 'nearest' }, true), SAMPLE_MIN_NEAREST);
  assert.equal(filterOf({ minFilter: 'linear' }), SAMPLE_MIP_NONE);
  assert.equal(
    filterOf({ minFilter: 'nearest-mip-nearest' }, true),
    filterOf({ minFilter: 'nearest-mip-nearest' }),
    'a mip rule is the same on both',
  );
});

// #360, #361: the rule both GPU paths share (`grantedAnisotropy`): a linear magnification over a
// chain mixed across levels, or nothing.
test('anisotropy is clamped to the ceiling, and granted only to a linear read mixed across levels', () => {
  const granted = (word: number) => ((word >> SAMPLE_ANISOTROPY_SHIFT) & 15) + 1;
  assert.equal(granted(filterOf({ anisotropy: 8 })), 8);
  assert.equal(granted(filterOf({ anisotropy: 64 })), MAX_ANISOTROPY);
  assert.equal(granted(filterOf({ anisotropy: 0 })), 1);
  assert.equal(granted(filterOf({ anisotropy: 16, minFilter: 'nearest-mip-linear' })), 16);
  assert.equal(granted(filterOf({ anisotropy: 16, magFilter: 'nearest' })), 1);
  assert.equal(granted(filterOf({ anisotropy: 16, minFilter: 'linear-mip-nearest' })), 1);
  assert.equal(granted(filterOf({ anisotropy: 16, minFilter: 'linear' })), 1);
});

// #360, #361: the shadow cutout reads one tap at the isotropic level; the camera cutout reads the
// alpha of the colour's own read, the taps its footprint's elongation asks.
test('the shadow cutout takes one tap, the camera cutout the colour read and its taps', () => {
  const shaded = atlasReadWgsl('colorSample', 'color', 'vec4f', true),
    shadow = maskAlphaWgsl(true);
  assert.match(shaded, /colorFootprint\(slot,s,uv,ddx,ddy,true\)/);
  assert.match(shaded, /if\(r\.taps>1u\)\{return colorSampleTaps\(s,r\);\}/);
  assert.match(shadow, /colorFootprint\(slot,s,uv,ddx,ddy,false\)/);
  assert.doesNotMatch(shadow, /taps/i);
  assert.equal(
    maskAlphaWgsl(false),
    'fn maskAlpha(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f,sampled:bool)->f32{return colorSample(slot,uv,ddx,ddy,sampled).w;}',
  );
  // Face-on, up to rounding, the footprint is not elongated: one tap at the isotropic level.
  assert.match(SAMPLING_WGSL, /if\(ratio>1\.01\)\{\s*raw-=log2\(ratio\);\s*taps=/);
});

/** The shader's own ratio and taps lines, run on the CPU: WGSL's calls read as `Math`'s, `u32` as
 *  a truncation, the `u` of an unsigned literal dropped. */
const tapsOf = (lx: number, ly: number, granted: number) => {
  const line = (name: string) => {
    const found = SAMPLING_WGSL.match(new RegExp(`${name}=([^;]+);`));
    assert.ok(found, name);
    return found[1]
      .replace(/\b(min|max|sqrt|ceil)\(/g, 'Math.$1(')
      .replace(/\bu32\(/g, 'Math.trunc(')
      .replace(/\bf32\(/g, '(')
      .replace(/(\d)u\b/g, '$1');
  };
  return new Function(
    'lx',
    'ly',
    'granted',
    `const ratio=${line('let ratio')};return ${line(';\\s*taps')};`,
  )(lx, ly, granted) as number;
};

// #443: a footprint stretched up to the grant is read with as many taps as it is stretched: 16
// over 16 texels, never a cap below the grant; beyond the grant, the grant.
test('an anisotropic footprint takes as many taps as its ratio, up to the grant', () => {
  assert.equal(tapsOf(16 * 16, 1, MAX_ANISOTROPY), 16);
  assert.equal(tapsOf(1, 12 * 12, MAX_ANISOTROPY), 12);
  assert.equal(tapsOf(64 * 64, 1, MAX_ANISOTROPY), MAX_ANISOTROPY);
  assert.equal(tapsOf(16 * 16, 1, 4), 4);
  assert.equal(tapsOf(2.5 * 2.5, 1, MAX_ANISOTROPY), 3);
});

test('the affine part of the transform is carried, and flagged when it is not the identity', () => {
  // Repeat 4 × 2, offset (0.25, 0.5), a quarter turn: three columns of three.
  const transform = [0, -2, 0, 4, 0, 0, 0.25, 0.5, 1];
  const words = samplingWords(record({ transform }), false);
  assert.equal(words[0], SAMPLE_TRANSFORMED);
  assert.deepEqual([...new Float32Array(words.buffer, 4, 6)], [0, -2, 4, 0, 0.25, 0.5]);
});

// #360, #361: a tap line that stays in one period, off its seams, is folded once and read one
// level at a time — a table entry once per tile —, the two levels mixed once; a line that meets
// a seam or leaves its period folds each tap alone, as a one-tap read does.
test('an anisotropic line is folded once when it stays in its period', () => {
  const shaded = atlasReadWgsl('colorSample', 'color', 'vec4f', true);
  assert.match(shaded, /let line=foldLine\(r,s\.wrap,s\.size\);/);
  assert.match(
    shaded,
    /if\(line\.dir\.x==0\.0\)\{[^}]*colorSampleTap\(s,r\.uv\+r\.axis\*tapOffset\(i,n\)/,
  );
  assert.match(
    shaded,
    /return mix\(a,colorLine\(s,line\.uv,step,n,u32\(l0\)\+1u,r\.nearest\),t\);/,
  );
});
