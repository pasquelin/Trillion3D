// #55: the cutout stipple. An accumulating pixel of either raster moves its alpha threshold by a
// stipple the temporal pass averages back into partial coverage; every other reader — a frame
// without temporal antialiasing, the shadows — keeps the hard threshold, to the bit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MASK_KEEP_WGSL, STIPPLE_WGSL, UV_GRADIENTS_WGSL, VIS_UNIFORMS_WGSL } from './pageWgsl.ts';
import { SHADE_SHADER } from './shadeWgsl.ts';
import { uvDerivatives } from '../math.ts';
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

test('both rasters stipple; the shadows pass zero', () => {
  assert.equal(VIS_SHADER.split(STIPPLE_WGSL).length - 1, 1);
  assert.equal(VIS_SHADER.split('gx,gy,stippleOffset(in.position.xy))').length - 1, 2);
  assert.doesNotMatch(SHADOW_DEPTH_SHADER, /stippleOffset/);
  assert.match(SHADOW_DEPTH_SHADER, /maskKeep\(pages\[in\.instance\],in\.uv,1\.0,gx,gy,0\.0\)/);
});

test('the compute raster stipples at its footprint, and keeps the hard cutout otherwise', () => {
  const small = rasterSource(4, 16);
  assert.equal(small.split(STIPPLE_WGSL).length - 1, 1);
  // Without a stipple word: null gradients (level 0) and a null offset, the hard test to the bit.
  assert.match(
    small,
    /var gx=vec2f\(0\.0\);var gy=vec2f\(0\.0\);var stipple=0\.0;\n {2}if\(uni\.stipple!=0u\)\{/,
  );
  // With one: the footprint of the covering sub-triangle, the offset at this pixel.
  assert.match(
    small,
    /uvGradients\(t\.a,select\(t\.b,t\.c,second\),select\(t\.c,t\.d,second\),sample,t\.ua\.xy,nb\.xy,nc\.xy,1\.0\/vec3f\(t\.ca\.w,qb\.w,qc\.w\)\);\n {3}gx=g\[0\];gy=g\[1\];stipple=stippleOffset\(sample\);/,
  );
  assert.match(small, /if\(!maskKeep\(page,tc\.xy,tc\.z,gx,gy,stipple\)\)\{return;\}/);
  assert.doesNotMatch(small, /maskKeep\(page,tc\.xy,tc\.z,vec2f\(0\.0\)/);
});

test('the compute raster reads the gradients of the resolve, which are exact at the pixel', () => {
  // One formula: the resolve and the compute raster insert it, neither keeps a copy.
  for (const source of [rasterSource(4, 16), SHADE_SHADER]) {
    assert.equal(source.split(UV_GRADIENTS_WGSL).length - 1, 1);
    assert.match(source, /=uvGradients\(/);
    assert.doesNotMatch(source.replace(UV_GRADIENTS_WGSL, ''), /dUdx|dsdx/);
  }
  // Its CPU mirror, same quotients, against central differences of perspective-correct
  // interpolation on a steep triangle.
  const at = (x: number, y: number, invW: number) =>
    ({ x, y, z: 0, invW, worldX: 0, worldY: 0, worldZ: 0 }) as const;
  const a = at(3, 5, 1),
    b = at(41, 9, 0.2),
    c = at(12, 37, 0.05);
  const [uva, uvb, uvc] = [
    [0, 0],
    [4, 0.5],
    [1, 6],
  ] as [number, number][];
  const uvAt = (x: number, y: number) => {
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    const wb = ((x - a.x) * (c.y - a.y) - (y - a.y) * (c.x - a.x)) / area;
    const wc = ((y - a.y) * (b.x - a.x) - (x - a.x) * (b.y - a.y)) / area;
    const q = [(1 - wb - wc) * a.invW, wb * b.invW, wc * c.invW];
    const sum = q[0]! + q[1]! + q[2]!;
    return [0, 1].map((k) => (q[0]! * uva[k]! + q[1]! * uvb[k]! + q[2]! * uvc[k]!) / sum);
  };
  const [x, y, h] = [15.5, 14.5, 1e-4];
  const d = uvDerivatives(a, b, c, uva, uvb, uvc, x, y);
  const dx = [0, 1].map((k) => (uvAt(x + h, y)[k]! - uvAt(x - h, y)[k]!) / (2 * h));
  const dy = [0, 1].map((k) => (uvAt(x, y + h)[k]! - uvAt(x, y - h)[k]!) / (2 * h));
  for (const [got, want] of [
    [d.duDx, dx[0]],
    [d.dvDx, dx[1]],
    [d.duDy, dy[0]],
    [d.dvDy, dy[1]],
  ] as [number, number][]) {
    assert.ok(Math.abs(got - want) < 1e-6 * Math.max(1, Math.abs(want)), `${got} vs ${want}`);
  }
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
