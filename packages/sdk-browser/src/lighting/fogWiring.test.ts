// Fog is a term of the one lighting model (#345): every program that lights a surface — the
// opaque resolve with and without bounce, the blended surfaces, the water composite and the
// WebGL2 program — hands its lit colour through `fogged` before the display chain, measured from
// the eye each pass carries; the unlit view and the composition are left as they were.
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

test('the opaque resolve fogs its lit sum at the pixel, from the eye in display.yzw', () => {
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER])
    assert.match(
      shader,
      /return vec4f\(fogged\(lit\+ambient\+emissive\.rgb.*,P,view\.display\.yzw\),1\.0\);/,
    );
  assert.doesNotMatch(UNLIT_LIGHTING_SHADER, /fogged/);
  assert.doesNotMatch(COMPOSE_SHADER, /fogged/);
});

test('blended and water surfaces fog their lit colour from the eye of the blend view', () => {
  assert.match(
    BLEND_SHADER,
    /rgb=fogged\(declaredLighting\(.*\+s\.emissive,in\.view,uni\.eye\.xyz\);/,
  );
  assert.match(WATER_COMPOSITE_SHADER, /select\(fogged\(color,P,uni\.eye\.xyz\),color,unlit\)/);
  // The eye is the view's last vec4: 112 bytes of fields before it, 16 of its own.
  assert.match(BLEND_VIEW_WGSL, /viewport:vec2f,eye:vec4f,\}/);
  assert.equal(BLEND_VIEW_SIZE, 128);
});

test('the WebGL2 program fogs a lit surface before its display curve', () => {
  const fogAt = CLUSTER_FRAGMENT.indexOf('if(lit)rgb=fogged(rgb);');
  assert.ok(fogAt > 0);
  assert.ok(fogAt < CLUSTER_FRAGMENT.indexOf('if(toneMapped)rgb=toneMap(rgb);'));
});
