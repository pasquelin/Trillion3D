// Shared formulas: the Lambert 1/π constant and the order-2 spherical-harmonics basis are
// written once, and every shader that needs them carries that one text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INVERSE_PI_WGSL } from './gridWgsl.ts';
import { BOUNCE_APPLY_WGSL } from './applyWgsl.ts';
import { BOUNCE_SURFACE_SHADER } from './surfaceWgsl.ts';
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts';
import { DIRECT_LIGHTING_WGSL } from '../lighting/direct/lightingWgsl.ts';
import { PROBE_IRRADIANCE_GLSL } from '../webgl/cluster/probe.ts';
import {
  irradianceShader,
  radianceProjectionShader,
} from '../../../sdk-core/src/scene/core/irradianceBasis.ts';

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

test('INVERSE_PI_WGSL declares the 1/π constant expected by both bounce passes', () => {
  assert.match(INVERSE_PI_WGSL, /const INVERSE_PI:f32=0\.31830989;/);
});

test('INVERSE_PI_WGSL appears once in the application and once in the surface cache', () => {
  assert.equal(occurrences(BOUNCE_APPLY_WGSL, INVERSE_PI_WGSL), 1);
  assert.equal(occurrences(BOUNCE_SURFACE_SHADER, INVERSE_PI_WGSL), 1);
});

test('every probe shader projects and evaluates the one order-2 basis', () => {
  // The bounce probes store their nine coefficients in the environment's band order: the pass
  // that fills them and the lookup that reads them compile the shared text, as do the scene
  // environment on WebGPU and the host light probe on WebGL2.
  const probeEvaluation = irradianceShader((k) => `probes[slot+${k}u].xyz`, 'n');
  assert.ok(BOUNCE_APPLY_WGSL.includes(probeEvaluation));
  assert.ok(BOUNCE_SURFACE_SHADER.includes(probeEvaluation));
  assert.ok(
    BOUNCE_PROBE_SHADER.includes(radianceProjectionShader((k) => `sums[${k}]`, 'sample.rgb', 'd')),
  );
  assert.ok(DIRECT_LIGHTING_WGSL.includes(irradianceShader((k) => `e[${k}].rgb`, 'N')));
  assert.ok(PROBE_IRRADIANCE_GLSL.includes(irradianceShader((k) => `probeSh[${k}]`, 'N')));
});
