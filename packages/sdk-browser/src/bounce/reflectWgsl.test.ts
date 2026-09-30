// A mirror reflects the scene (#31): with bounce on, the opaque resolve adds to a smooth surface the
// radiance its mirror direction meets in the resident proxy, read in the surface cache; the water
// reads the same function. Without bounce the direct program reflects the environment alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredLighting } from '../lighting/deferred/deferred.ts';
import type { DirectLightResources } from '../lighting/deferred/program.ts';
import type { SurfaceBuffer } from '../scene/surfaceBuffer.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts';
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts';
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';
import { BOUNCE_SURFACE_BINDING, SURFACE_RAY_WGSL } from './reflectWgsl.ts';
import { functionText as body } from './wgslBody.fixture.ts';
import {
  BOUNCE_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
  WATER_COMPOSITE_SHADER,
} from '../gpu/core/shaderTexts.fixture.ts';

test('with bounce, a smooth surface adds what its mirror direction meets in the proxy', () => {
  // The term is part of the lit sum, fed the pixel's own roughness.
  assert.match(
    BOUNCE_LIGHTING_SHADER,
    /var rgb=lit\+ambient\+emissive\.rgb\+bounceLighting\([^)]*\)\+thinBounce\([^)]*\)\+mirrorLighting\(base\.rgb,base\.a,normal\.a,N,V,P\);if\(\(surfaceFlag&128u\)==0u\)\{rgb=fogged\(rgb,P,/,
  );
  const mirror = body(BOUNCE_LIGHTING_SHADER, 'mirrorLighting');
  assert.ok(mirror.includes('reflectedRadiance(P,N,reflect(-V,N),rough)'));
  // Weighed by the GGX lobe's directional albedo, the table the rectangular light reads.
  assert.match(mirror, /ltcLookup\(rough,[^;]*,1u\)/);
  // The radiance is the proxy face the ray hits, read in the cache: the reflected scene.
  const reflected = body(BOUNCE_LIGHTING_SHADER, 'proxyReflectionRay');
  assert.match(
    reflected,
    /rayRadiance\(P\+N\*proxy\.offsetMetres\+R\*proxy\.startMetres,R,reach\)/,
  );
  assert.match(reflected, /if\(hit\.w<reach\)\{return hit\.rgb;\}/);
  // The cache is an atlas (#1410): the texel's row and column, read exactly.
  assert.match(
    body(BOUNCE_LIGHTING_SHADER, 'rayRadiance'),
    /return vec4f\(textureLoad\(surface,vec2u\(texel%size\.x,texel\/size\.x\),0\)\.rgb/,
  );
  assert.match(
    BOUNCE_LIGHTING_SHADER,
    new RegExp(`@binding\\(${BOUNCE_SURFACE_BINDING}\\) var surface:texture_2d<f32>;`),
  );
});

test('diffuse and toon keep no specular lobe, while rough physical materials retain their probe lobe', () => {
  const mirror = body(BOUNCE_LIGHTING_SHADER, 'mirrorLighting');
  assert.match(
    mirror,
    new RegExp('if\\(surfaceModel==4u\\|\\|surfaceModel==5u\\)\\{return vec3f\\(0\\.0\\);\\}'),
  );
  // The floor is the clamp the surface buffer is written at, and it survives the half-float target.
  assert.ok(SHADE_SHADER.includes(`clamp(page.roughness*roughSample.y,${ROUGHNESS_FLOOR},1.0)`));
  // In [2⁻⁵, 2⁻⁴) a half float steps by 2⁻¹⁵: the floor rounds to a value the test still admits.
  const floor = Number(ROUGHNESS_FLOOR);
  assert.ok(floor >= 2 ** -5 && floor < 2 ** -4);
  assert.ok(Math.round(floor * 2 ** 15) / 2 ** 15 <= floor);
});

test('the direct base has no proxy fallback; the bounce variant binds its surface cache', async () => {
  assert.doesNotMatch(DIRECT_LIGHTING_SHADER, /rayRadiance|sampleProbeField/);
  // Without probes the reflection reads the environment before firing a ray (#1341).
  assert.match(
    body(BOUNCE_LIGHTING_SHADER, 'reflectedRadiance'),
    /^fn reflectedRadiance\([^)]*\)->vec3f\{\n if\(bounce\.counts\.w==0u\)\{return environmentReflection\(R,rough\);\}/,
  );
  const { device, bindGroups } = fakeDevice(),
    lighting = await createDeferredLighting(device),
    view = {} as GPUTextureView,
    surface = { views: () => [view, view, view, view] } as unknown as SurfaceBuffer,
    buffer = () => ({}) as GPUBuffer;
  const boundCache = (direct: DirectLightResources) => {
    lighting.bind(surface, view, view, true, { lights: buffer(), ...direct });
    const entries = Array.from(bindGroups.at(-1)!.entries);
    return entries.find((entry) => entry.binding === BOUNCE_SURFACE_BINDING)?.resource;
  };
  const cache = {} as GPUTextureView,
    bounce = { bounceGrid: buffer(), probes: {} as GPUTextureView, surfaceCache: cache };
  boundCache({});
  boundCache(bounce);
  await lighting.settle();
  assert.equal(boundCache({}), undefined);
  assert.equal(boundCache(bounce), cache, 'the cache atlas itself (#1410)');
  lighting.dispose();
});

test('water and probes read the same ray: one reflection model', () => {
  assert.match(
    WATER_COMPOSITE_SHADER,
    /reflected=F\*resolvedRadiance\(P,Nv,reflect\(-V,Nv\),rough\)/,
  );
  assert.doesNotMatch(WATER_COMPOSITE_SHADER, /sampleBounce\(P,reflect/);
  assert.ok(BOUNCE_PROBE_SHADER.includes(SURFACE_RAY_WGSL));
  assert.ok(BOUNCE_LIGHTING_SHADER.includes(SURFACE_RAY_WGSL));
});

test('water preserves its exact mirror ray and transitions into filtered probe radiance', () => {
  // The water's roughness reaches the model, clamped to the floor it traces at.
  assert.ok(WATER_COMPOSITE_SHADER.includes(`let rough=clamp(normal.a,${ROUGHNESS_FLOOR},1.0);`));
  assert.match(
    WATER_COMPOSITE_SHADER,
    /reflected=F\*resolvedRadiance\(P,Nv,reflect\(-V,Nv\),rough\)/,
  );
  const reflected = body(WATER_COMPOSITE_SHADER, 'reflectedRadiance');
  assert.match(reflected, /if\(weight==1\.0\)\{return proxyReflectionRay\(P,N,R\);\}/);
  assert.match(reflected, /mix\(filtered,proxyReflectionRay\(P,N,R\),weight\)/);
  assert.match(reflected, /if\(weight==0\.0\)\{return filtered;\}/);
  assert.ok(
    reflected.indexOf('weight==1.0') < reflected.indexOf('filteredProbeReflection'),
    'mirror does not evaluate the rough approximation',
  );
  // Without bounce sampleBounce is zero too: the early return changes no value.
  assert.match(
    body(WATER_COMPOSITE_SHADER, 'sampleProbeField'),
    /^fn sampleProbeField\([^)]*\)->vec3f\{\n if\(bounce\.counts\.w==0u\)\{return vec3f\(0\.0\);\}/,
  );
});
