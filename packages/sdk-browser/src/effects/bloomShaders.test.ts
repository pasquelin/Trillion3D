// The bloom's WGSL and GLSL (#349) read back as the taps the CPU oracle filters with: the text of
// each program, not the table it was generated from, is compared with the published filters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOOM_GLSL } from './bloomGlsl.ts';
import { BLOOM_WGSL } from './bloomWgsl.ts';
import { f16, publishedDownTaps, publishedUpTaps, tapsOf, tapWords } from './bloom.fixture.ts';
import { bloomBlend } from './bloomFilter.ts';
import { mulberry32 } from '../../../../site/examples/kit/random.ts';
import { BLOOM_COMPOSE_WGSL } from './bloomLevel.ts';
import { shaderFunctions } from '../texture/shaderRule.fixture.ts';
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from '../lighting/deferred/shaders.ts';

type Blend = Record<string, (image: number, pixel: number) => number>;

test('the WGSL downsample and tent are the published taps', () => {
  const down = BLOOM_WGSL.slice(BLOOM_WGSL.indexOf('fn down('), BLOOM_WGSL.indexOf('fn up('));
  const tent = BLOOM_WGSL.slice(BLOOM_WGSL.indexOf('fn tent('), BLOOM_WGSL.indexOf('fn down('));
  assert.deepEqual(tapWords(tapsOf(down)), tapWords(publishedDownTaps()));
  assert.deepEqual(tapWords(tapsOf(tent)), tapWords(publishedUpTaps()));
  assert.match(tent, /let stride=bloom\.inTexel\*bloom\.radius;/, 'the tent spreads by radius');
  assert.match(down, /let stride=bloom\.inTexel;/, 'the downsample reads texels of the level');
  assert.ok(BLOOM_WGSL.includes('textureSampleLevel(level,linearClamp,uv,0.0)'), 'bilinear reads');
});

test('the GLSL programs are the same taps, and the composite the same blend', () => {
  const head = BLOOM_GLSL.up.slice(0, BLOOM_GLSL.up.indexOf('void main'));
  const down = BLOOM_GLSL.down.slice(BLOOM_GLSL.down.indexOf('void main'));
  assert.deepEqual(tapWords(tapsOf(down)), tapWords(publishedDownTaps()));
  assert.deepEqual(tapWords(tapsOf(head)), tapWords(publishedUpTaps()));
  assert.match(head, /vec2 stride=sourceTexel\*radius;/);
  assert.match(down, /vec2 stride=sourceTexel;/);
  assert.match(BLOOM_GLSL.up, /color=tent\(gl_FragCoord\.xy\*targetTexel\);/);
  assert.match(
    BLOOM_GLSL.composite,
    /color=texelFetch\(scene,ivec2\(gl_FragCoord\.xy\),0\)\*keep\+tent\(gl_FragCoord\.xy\*targetTexel\)\*glow;/,
  );
  assert.match(
    BLOOM_WGSL,
    /return blendLevel\(textureLoad\(scene,vec2i\(pixel\.xy\),0\),pixel\.xy\);/,
  );
  assert.match(
    BLOOM_WGSL,
    /fn blendLevel\(image:vec4f,pixel:vec2f\)->vec4f\{return image\*bloom\.keep\+tent\(pixel\*bloom\.outTexel\)\*bloom\.glow;\}/,
  );
});

// #963: the composition blends the last bloom in itself. Its `bloomed` must give what develop's
// `composite` pass stored in its `rgba16float` target, which the composition then read: the f32
// blend converted to half, ties to even, ±Inf past the half range, NaN kept. Every channel is taken
// alone, a scalar, as `blendLevel` treats each alike; `quantizeToF16` refuses what WGSL leaves
// indeterminate (past the finite halves), so no pixel rests on an undefined value.
const F32_MAX = 3.4028234663852886e38;
const EDGES = [
  NaN,
  0,
  -0,
  Infinity,
  -Infinity,
  65504,
  -65504,
  65519,
  65520,
  -65520,
  65536,
  F32_MAX,
  -F32_MAX,
  2 ** -24,
  2 ** -25,
  -(2 ** -14),
  1e-45,
  0.3,
  1,
  7.5,
];
/** Seeded values over every order of magnitude the radiance reaches, either sign. */
function randomValues(count: number) {
  const r = mulberry32(963);
  return Array.from({ length: count }, () => (r() < 0.2 ? -1 : 1) * 2 ** (r() * 60 - 36));
}
const quantizeToF16 = (x: number) => {
  assert.ok(Math.abs(x) <= 65504, `quantizeToF16(${x}) is indeterminate`);
  return f16(x);
};

test("the half store matches Node's where it has one", { skip: !('f16round' in Math) }, () => {
  const round = (Math as unknown as { f16round: (x: number) => number }).f16round;
  for (const x of [...EDGES, ...randomValues(2000), 65503.99, 2 ** -24 * 1.5, 2 ** -24 * 2.5])
    assert.equal(f16(Math.fround(x)), round(Math.fround(x)), `${x}`);
});

test("the composition blends the last level in as develop's half-float target held it (#963)", () => {
  const values = [...EDGES, ...randomValues(60)],
    r = mulberry32(1073);
  const intensities = [0, 0.04, 0.25, 1, r(), r()];
  for (const source of [
    ...Object.values(CONTRACT_COMPOSITIONS.bloom),
    ...Object.values(UNLIT_COMPOSITIONS.bloom),
  ])
    for (const intensity of intensities) {
      const at = {
        bloom: { ...bloomBlend(intensity, 6), outTexel: 1 / 64 },
        tent: (uv: number) => values[Math.round(uv * 64)],
        vec4f: (x: number) => x,
        abs: Math.abs,
        clamp: (x: number, low: number, high: number) => Math.min(Math.max(x, low), high),
        quantizeToF16,
      };
      const pass = shaderFunctions<Blend>(BLOOM_WGSL, ['blendLevel'], at).blendLevel;
      // The GPU's blend is f32: `bloomed` reads it so, and returns f32.
      const f32 = (image: number, pixel: number) => Math.fround(pass(image, pixel));
      const fused = shaderFunctions<Blend>(source, ['bloomed'], { ...at, blendLevel: f32 }).bloomed;
      for (const image of values)
        for (let pixel = 0; pixel < values.length; pixel++)
          assert.equal(
            Math.fround(fused(image, pixel)),
            f16(f32(image, pixel)),
            `intensity ${intensity}, image ${image}, tent ${values[pixel]}`,
          );
    }
});

test('the bloomed composition is the plain one reading the blend, line for line (#963)', () => {
  for (const { plain, bloom } of [CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS])
    for (const input of ['still', 'accumulated'] as const) {
      assert.ok(bloom[input].includes(BLOOM_COMPOSE_WGSL));
      assert.equal(
        bloom[input]
          .replace(BLOOM_COMPOSE_WGSL, '')
          .replace('bloomed(textureLoad(hdr,coord,0),pixel.xy)', 'textureLoad(hdr,coord,0)'),
        plain[input],
      );
    }
});
