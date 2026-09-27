import test from 'node:test';
import assert from 'node:assert/strict';
import { HIZ_HIDDEN_WGSL, HIZ_HIDES_WGSL, HIZ_LEVEL_WGSL } from './rectWgsl.ts';
import { HIZ_SHADER } from './shader.ts';
import { PARTITION_CLASSIFY_WGSL } from '../partition/classifyWgsl.ts';
import { SHADOW_OCCLUSION_SHADER } from '../shadow/occlusionShader.ts';

// The shipped WGSL is the one `coarsePretest.test.ts` transcribes: these lines pin it.

test('the three Hi-Z tests read through the coarse pre-test, and no whole-footprint walk is left', () => {
  assert.match(HIZ_LEVEL_WGSL, /fn hizCoarseLevel\(rect:vec4i,l:u32,levels:u32\)->u32\{/);
  assert.match(HIZ_LEVEL_WGSL, /if\(c\+1u>=levels\|\|fitsAt\(rect,c,2\)\)\{break;\}/);
  assert.match(
    HIZ_HIDES_WGSL,
    /if\(!\(nearest<pyramid\[offset\+u32\(y\)\*width\+u32\(x\)\]-bias\)\)\{return false;\}/,
  );
  for (const shader of [HIZ_HIDDEN_WGSL, HIZ_SHADER, SHADOW_OCCLUSION_SHADER])
    assert.match(shader, /pyramidHides\(/);
  for (const shader of [
    HIZ_HIDDEN_WGSL,
    HIZ_SHADER,
    SHADOW_OCCLUSION_SHADER,
    PARTITION_CLASSIFY_WGSL,
  ])
    assert.doesNotMatch(shader, /pyramidFar/);
  // The mip pick returns the coarse mip too: every caller reads it from there.
  assert.match(HIZ_LEVEL_WGSL, /return vec3u\(l,1u,hizCoarseLevel\(rect,l,levels\)\);/);
  for (const shader of [HIZ_HIDDEN_WGSL, SHADOW_OCCLUSION_SHADER])
    assert.match(shader, /let l=pick\.x;let c=pick\.z;/);
  // The partition packs the coarse mip into the three words `testHiz` reads it from.
  assert.match(PARTITION_CLASSIFY_WGSL, /coarse=pick\.z;/);
  assert.match(PARTITION_CLASSIFY_WGSL, /tested\[slot\+11u\]=coarse-level;/);
  assert.match(HIZ_SHADER, /triangles:u32,coarseOffset:u32,coarseWidth:u32,coarseShift:u32,\}/);
  assert.match(
    HIZ_SHADER,
    /b\.fineOffset,b\.fineWidth,b\.nearest,bias,b\.coarseOffset,b\.coarseWidth,b\.coarseShift\)/,
  );
});
