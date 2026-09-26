// #527: the families the engine maps onto its one model draw on the WebGL2 path, each shaded by
// the rule the WebGPU path reads, instead of being refused at prepare.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as G from '../../host/graph/graph.fixture.ts';
import { clusterMaterialReason } from './compatibility.ts';
import { CLUSTER_FRAGMENT } from './shaders.ts';
import {
  SURFACE_MODEL_GLSL,
  SURFACE_MODEL_LIGHT_WGSL,
  SURFACE_MODEL_SHADE_WGSL,
} from '../../scene/surfaceModel.ts';

const position = new G.BufferAttribute(new Float32Array(9), 3);
const normal = new G.BufferAttribute(new Float32Array(9), 3);
const FAMILIES = ['lambert', 'phong', 'toon', 'normal', 'matcap'] as const;

test('Lambert, Phong, toon, normal and matcap draw on WebGL2, each asking for its normals', () => {
  for (const family of FAMILIES) {
    const surface = new G.GraphSurface(family);
    assert.equal(clusterMaterialReason(surface, { position, normal }), undefined, family);
    assert.equal(
      clusterMaterialReason(surface, { position }),
      `${family} material has no normal attribute`,
    );
  }
});

test("A matcap's image is checked as a map, and asks for no UV: the normal reads it", () => {
  const image = G.dataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, G.HOST_FORMAT_RGBA);
  const matcap = (texture: unknown) => new G.GraphSurface('matcap', { matcap: texture });
  assert.equal(clusterMaterialReason(matcap(image), { position, normal }), undefined);
  const empty = G.dataTexture(new Uint8Array(4), 1, 1, G.HOST_FORMAT_RGBA);
  empty.image = undefined as never;
  assert.equal(
    clusterMaterialReason(matcap(empty), { position, normal }),
    'texture image is unavailable',
  );
});

test('The two languages read one toon band and one matcap coordinate', () => {
  const band = 'mix(0.7,1.0,smoothstep(0.69,0.71,nl*0.5+0.5))';
  assert.ok(SURFACE_MODEL_LIGHT_WGSL.includes(`diffuse*${band}`));
  assert.ok(SURFACE_MODEL_GLSL.includes(`diffuse*${band}`));
  assert.ok(SURFACE_MODEL_SHADE_WGSL.includes('return vec2f(n.x*0.495+0.5,0.5-n.y*0.495);'));
  assert.ok(SURFACE_MODEL_GLSL.includes('return vec2(n.x*0.495+0.5,0.5-n.y*0.495);'));
  // Each lamp gives a diffuse or toon surface the model's lobe alone, never the specular one.
  assert.match(
    CLUSTER_FRAGMENT,
    /if\(bandedModel\(\)\)\{direct\+=modelLight\([^;]+;continue;\}vec3 E=/,
  );
  // A matcap reads its base map at the view normal; a normal surface shows it, after the fog.
  assert.match(CLUSTER_FRAGMENT, /surfaceModel==4\?matcapUv\(normalize\(viewNormal\)\)/);
  assert.match(CLUSTER_FRAGMENT, /rgb=fogged\(rgb\);[^]*if\(surfaceModel==3\)rgb=N\*0\.5\+0\.5;/);
});
