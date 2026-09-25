// The bloom's WGSL and GLSL (#349) read back as the taps the CPU oracle filters with: the text of
// each program, not the table it was generated from, is compared with the published filters.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BloomTap } from './bloomFilter.ts';
import { BLOOM_GLSL } from './bloomGlsl.ts';
import { BLOOM_WGSL } from './bloomWgsl.ts';
import { publishedDownTaps, publishedUpTaps, tapWords } from './bloom.fixture.ts';

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
    /return textureLoad\(scene,vec2i\(pixel\.xy\),0\)\*bloom\.keep\+tent\(pixel\.xy\*bloom\.outTexel\)\*bloom\.glow;/,
  );
});
