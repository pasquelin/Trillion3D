// Fog is a term of the one lighting model (#345): every program that lights a surface — the
// opaque resolve with and without bounce, the blended surfaces, the water composite and the
// WebGL2 program — hands its lit colour through `fogged` before the display chain, measured from
// the eye each pass carries. An unlit material is fogged too, as in the reference; a normal or depth
// material, the diagnostic views and the composition are left as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOUNCE_LIGHTING_SHADER,
  COMPOSE_SHADER,
  DIRECT_LIGHTING_SHADER,
  UNLIT_LIGHTING_SHADER,
} from './deferred/shaders.ts';
import { BLEND_SHADER, BLEND_VIEW_WGSL } from '../webgpu/blend/shader.ts';
import { BLEND_VIEW_SIZE } from '../webgpu/blend/uniforms.ts';
import { WATER_COMPOSITE_SHADER } from '../webgpu/water/compositeWgsl.ts';
import { CLUSTER_FRAGMENT } from '../webgl/cluster/shaders.ts';
import { SHADE_SHADER as SURFACE_SHADE } from '../visibility/shader/shadeWgsl.ts';

test('the opaque resolve fogs its lit sum at the pixel, from the eye in display.yzw', () => {
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER])
    assert.match(
      shader,
      /return vec4f\(fogged\(lit\+ambient\+emissive\.rgb.*,P,view\.display\.yzw\),1\.0\);/,
    );
  // An unlit or matcap surface (flag 1) is fogged; a diagnostic, normal or depth one (flag 3) is not.
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER]) {
    assert.match(shader, /if\(flag==3u\)\{return vec4f\(base\.rgb,1\.0\);\}/);
    assert.match(
      shader,
      /if\(flag==1u\)\{return vec4f\(fogged\(base\.rgb,P,view\.display\.yzw\),1\.0\);\}/,
    );
  }
  assert.match(SURFACE_SHADE, /select\(3u,1u,model==4u\)/);
  assert.doesNotMatch(UNLIT_LIGHTING_SHADER, /fogged/);
  assert.doesNotMatch(COMPOSE_SHADER, /fogged/);
});

test('blended and water surfaces, lit or unlit, are fogged from the eye of the blend view', () => {
  // The lit sum closes inside the lit branch; the fog closes the branch that skips the unlit view.
  assert.match(
    BLEND_SHADER,
    /if\(!unlit\)\{\s+if\(\(flags&1u\)!=0u\)\{[^]*?\+s\.emissive;\s+\}\s+\/\/.*\s+rgb=fogged\(rgb,in\.view,uni\.eye\.xyz\);\s+\}/,
  );
  assert.match(WATER_COMPOSITE_SHADER, /select\(fogged\(color,P,uni\.eye\.xyz\),color,unlit\)/);
  // The eye is the view's last vec4: 112 bytes of fields before it, 16 of its own.
  assert.match(BLEND_VIEW_WGSL, /viewport:vec2f,eye:vec4f,\}/);
  assert.equal(BLEND_VIEW_SIZE, 128);
});

test('the WebGL2 program fogs every surface before its display curve, a depth one excepted', () => {
  const fogAt = CLUSTER_FRAGMENT.indexOf('\nrgb=fogged(rgb);');
  assert.ok(fogAt > 0);
  // A depth material's ramp is written over the fogged colour.
  assert.ok(fogAt < CLUSTER_FRAGMENT.indexOf('if(depthShaded)rgb='));
  assert.ok(fogAt < CLUSTER_FRAGMENT.indexOf('if(toneMapped)rgb=toneMap(rgb);'));
});
