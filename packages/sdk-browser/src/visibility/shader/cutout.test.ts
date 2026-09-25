// #55: the cutout is the hard threshold in every raster and every image, as it was before the
// stipple (9893b51d9). The stippled threshold (#529, #556) turned the leaves of a still, temporally
// antialiased image into blotches (measure ko); it is gone, and nothing reads a stipple word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MASK_KEEP_WGSL } from './pageWgsl.ts';
import { VIS_SHADER } from './visWgsl.ts';
import { ENGINE_SHADERS } from '../../gpu/core/engineShaders.fixture.ts';
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
  // The call sites themselves are pinned by `maskVertexAlpha.test.ts`. Camera: the fragment's own
  // derivatives. Compute raster: none, level 0.
  assert.equal(VIS_SHADER.split('let gx=dpdx(in.tc.xy);let gy=dpdy(in.tc.xy);').length, 3);
  assert.doesNotMatch(
    ENGINE_SHADERS.RASTER!,
    /uvGradients/,
    'the compute raster computes no footprint',
  );
  for (const [name, source] of Object.entries(ENGINE_SHADERS))
    assert.doesNotMatch(source, /stipple/i, name);
});
