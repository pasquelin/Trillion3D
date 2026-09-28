// The bloom's WGSL and GLSL (#349) read back as the taps the CPU oracle filters with: the text of
// each program, not the table it was generated from, is compared with the published filters.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BloomTap } from './bloomFilter.ts';
import { BLOOM_GLSL } from './bloomGlsl.ts';
import { BLOOM_WGSL } from './bloomWgsl.ts';
import { publishedDownTaps, publishedUpTaps, tapWords } from './bloom.fixture.ts';
import { bloomBlend } from './bloomFilter.ts';
import { BLOOM_COMPOSE_WGSL } from './bloomLevel.ts';
import { shaderFunctions } from '../texture/shaderRule.fixture.ts';
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from '../lighting/deferred/shaders.ts';

type Blend = Record<string, (image: number, pixel: number) => number>;
/** The nearest half float, ties to even: what an `rgba16float` target stores. */
const half = (Math as unknown as { f16round: (x: number) => number }).f16round;

/** Every `c+=<read>(uv+vec2(x,y)*stride)*w;` of a text, as taps. */
function tapsOf(text: string): BloomTap[] {
  const taps: BloomTap[] = [];
  const pattern = /c\+=\w+\((?:level,)?uv\+vec2f?\(([-\d.]+),([-\d.]+)\)\*stride\)\*([\d.e-]+);/g;
  for (const [, x, y, w] of text.matchAll(pattern)) taps.push([Number(x), Number(y), Number(w)]);
  return taps;
}
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

// #963: the composition blends the last bloom in itself. Its `bloomed` must give what the bloom's
// `composite` pass stored in its `rgba16float` target, which the composition then read: every
// channel is taken alone, a scalar, as `blendLevel` treats each alike.
test('the composition blends the last level in as the half-float target held it (#963)', () => {
  const tents = [0, 1e-4, 0.3, 1, 7.5, 1000, 65504];
  const scope = (image: number) => ({
    bloom: { keep: 0, glow: 0, outTexel: 1 / 64 },
    tent: (uv: number) => tents[Math.round(uv * 64) % tents.length],
    textureLoad: () => image,
    vec2i: (xy: number) => xy,
    vec4f: (x: number) => x,
    quantizeToF16: half,
  });
  const names = ['blendLevel', 'bloomed'];
  for (const source of [
    ...Object.values(CONTRACT_COMPOSITIONS.bloom),
    ...Object.values(UNLIT_COMPOSITIONS.bloom),
  ])
    for (const intensity of [0.04, 0.25, 1])
      for (const image of [0, 1e-5, 0.1, 0.7, 3, 250, 65504]) {
        const at = scope(image),
          blend = bloomBlend(intensity, 6);
        Object.assign(at.bloom, blend);
        const pass = shaderFunctions<Blend>(BLOOM_WGSL, names.slice(0, 1), at).blendLevel,
          fused = shaderFunctions<Blend>(source, names, at).bloomed;
        for (let pixel = 0; pixel < tents.length; pixel++)
          assert.equal(
            fused(image, pixel),
            half(pass(image, pixel)),
            `${intensity} ${image} ${pixel}`,
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
