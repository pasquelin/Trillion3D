// #55: the cutout stipple. An accumulating camera pixel moves its alpha threshold by a stipple
// the temporal pass averages back into partial coverage; every other reader — a frame without
// temporal antialiasing, the shadows, the compute raster — keeps the hard threshold, to the bit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MASK_KEEP_WGSL, STIPPLE_WGSL, VIS_UNIFORMS_WGSL } from './pageWgsl.ts';
import { VIS_SHADER } from './visWgsl.ts';
import { SHADOW_DEPTH_SHADER } from '../../gpu/shadow/shader.ts';
import { rasterSource } from '../../gpu/raster/shader.ts';
import { VIS_UNIFORM_BYTES } from '../../webgpu/core/bindLayout.ts';
import { createTaaFrameState, taaStippleWord } from '../../taa/frame.ts';
import { TAA_SAMPLES } from '../../taa/jitter.ts';
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts';

test('a null stipple is the hard threshold, read before any footprint', () => {
  assert.match(
    MASK_KEEP_WGSL,
    /if\(stipple==0\.0\)\{return alpha>=page\.baseColor\.w;\}\n let size=colorSlot/,
  );
  // The spread is zero while a texel covers a pixel or more, the whole range from one level up.
  assert.match(
    MASK_KEEP_WGSL,
    /alpha>=page\.baseColor\.w\+stipple\*saturate\(atlasLod\(ddx\*size,ddy\*size\)\)/,
  );
});

test('only the camera raster stipples; shadows and the compute raster pass zero', () => {
  assert.equal(VIS_SHADER.split(STIPPLE_WGSL).length - 1, 1);
  assert.equal(VIS_SHADER.split('gx,gy,stippleOffset(in.position.xy))').length - 1, 2);
  assert.doesNotMatch(SHADOW_DEPTH_SHADER, /stippleOffset/);
  assert.match(SHADOW_DEPTH_SHADER, /maskKeep\(pages\[in\.instance\],in\.uv,gx,gy,0\.0\)/);
  const small = rasterSource(4, 16);
  assert.doesNotMatch(small, /stippleOffset/);
  assert.match(small, /maskKeep\(page,tc,vec2f\(0\.0\),vec2f\(0\.0\),0\.0\)/);
});

test('the stipple is zero without a rank and walks the jitter cycle otherwise', () => {
  assert.match(STIPPLE_WGSL, /if\(uni\.stipple==0u\)\{return 0\.0;\}/);
  assert.match(STIPPLE_WGSL, new RegExp(`/${TAA_SAMPLES}\\.0-0\\.5;`));
});

test('the uniform size covers its words, rounded to the matrix alignment', () => {
  const words = VIS_UNIFORMS_WGSL.replace(/.*viewProj:mat4x4f,/, '').match(/:(f32|u32)/g)!;
  const vec2 = (VIS_UNIFORMS_WGSL.match(/:vec2f/g) ?? []).length;
  const bytes = 64 + 4 * words.length + 8 * vec2;
  assert.match(VIS_UNIFORMS_WGSL, /stipple:u32,\}$/);
  assert.equal(VIS_UNIFORM_BYTES, Math.ceil(bytes / 16) * 16);
});

test('the stipple word is the jitter rank plus one on an accumulating frame, zero otherwise', () => {
  const frame = createTaaFrameState();
  const rt = { gpu: { temporal: { frame } } } as unknown as WebgpuPagesRuntime;
  assert.equal(taaStippleWord(rt), 0, 'a frame that does not accumulate keeps the hard threshold');
  frame.active = true;
  for (let sample = 0; sample < TAA_SAMPLES; sample++) {
    frame.sample = sample;
    assert.equal(taaStippleWord(rt), sample + 1);
  }
  rt.gpu.temporal = undefined;
  assert.equal(taaStippleWord(rt), 0, 'without temporal antialiasing, no stipple');
});
