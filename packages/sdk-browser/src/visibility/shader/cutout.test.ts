// #55: the cutout is the hard threshold in every raster and every image, as it was before the
// stipple (9893b51d9). The stippled threshold (#529, #556) turned the leaves of a still, temporally
// antialiased image into blotches (measure ko); it is gone, and nothing reads a stipple word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MASK_KEEP_WGSL, VIS_UNIFORMS_WGSL } from './pageWgsl.ts';
import { VIS_SHADER } from './visWgsl.ts';
import { SHADOW_DEPTH_SHADER } from '../../gpu/shadow/shader.ts';
import { rasterSource } from '../../gpu/raster/shader.ts';
import { ENGINE_SHADERS } from '../../gpu/core/engineShaders.fixture.ts';
import { VIS_UNIFORM_BYTES } from '../../webgpu/core/bindLayout.ts';
import { FLAG_HAS_COLOR, FLAG_SAMPLED } from '../types.ts';

test('the cutout is the hard threshold: the test of 9893b51d9, with the dash and vertex alpha', () => {
  // 9893b51d9 read `maskAlpha(...)>=page.baseColor.w` after the flag test. Since then #359 cuts a
  // dashed line's gaps and #347 multiplies by the vertex alpha; nothing else may stand between
  // the read and the threshold.
  assert.equal(
    MASK_KEEP_WGSL.replace(/\n *\/\/[^\n]*/g, ''),
    `fn maskKeep(page:PageInfo,uv:vec2f,vertexAlpha:f32,ddx:vec2f,ddy:vec2f)->bool{
 if((page.flags&128u)==0u){return true;}
 if(!lineDash(uv.x,page.dash)){return false;}
 if(page.baseColor.w<=0.0){return true;}
 let coloured=(page.flags&${FLAG_HAS_COLOR}u)!=0u;
 if((page.flags&8u)==0u){return !coloured||vertexAlpha>=page.baseColor.w;}
 var alpha=maskAlpha(page.mapIndex,uv,ddx,ddy,(page.flags&${FLAG_SAMPLED}u)!=0u);
 if(coloured){alpha*=vertexAlpha;}
 return alpha>=page.baseColor.w;
}`,
  );
});

test('every raster calls it as before the stipple, and no shader reads a stipple', () => {
  // Camera: the fragment's own derivatives. Compute raster: none, level 0. Shadows: vertex alpha one.
  assert.equal(VIS_SHADER.split('maskKeep(pages[in.instance],in.tc.xy,in.tc.z,gx,gy)').length, 3);
  assert.equal(VIS_SHADER.split('let gx=dpdx(in.tc.xy);let gy=dpdy(in.tc.xy);').length, 3);
  const small = rasterSource(4, 16);
  assert.ok(small.includes('if(!maskKeep(page,tc.xy,tc.z,vec2f(0.0),vec2f(0.0))){return;}'));
  assert.doesNotMatch(small, /uvGradients/, 'the compute raster computes no footprint');
  assert.ok(SHADOW_DEPTH_SHADER.includes('maskKeep(pages[in.instance],in.uv,1.0,gx,gy)'));
  for (const [name, source] of Object.entries({ ...ENGINE_SHADERS, small }))
    assert.doesNotMatch(source, /stipple/i, name);
});

test('the uniform size covers its words, rounded to the matrix alignment', () => {
  const words = VIS_UNIFORMS_WGSL.replace(/.*viewProj:mat4x4f,/, '').match(/:(f32|u32)/g)!;
  const vec2 = (VIS_UNIFORMS_WGSL.match(/:vec2f/g) ?? []).length;
  const bytes = 64 + 4 * words.length + 8 * vec2;
  assert.match(VIS_UNIFORMS_WGSL, /selectionEnabled:u32,pixelRatio:f32,\}$/);
  assert.equal(VIS_UNIFORM_BYTES, Math.ceil(bytes / 16) * 16);
});
