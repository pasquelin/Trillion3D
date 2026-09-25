// Shared formulas: the Lambert 1/π constant and the order-2 spherical-harmonics basis are
// written once, and every shader that needs them carries that one text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNCE_GRID_WGSL, INVERSE_PI_WGSL } from './gridWgsl.ts';
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

type Vector = { x: number; y: number; z: number };

/** A shader expression run on the CPU for one colour channel: coefficient `k` read as `c[k]`. */
const channel = (body: string, coefficient: RegExp, vector: string) =>
  new Function(
    'c',
    vector,
    body
      .replace(coefficient, (_, k: string | undefined) => `c[${k ?? 0}]`)
      .replace(/\b(var|let|vec3) (\w+)=/g, 'let $2=')
      .replace(/max\(vec3f?\(0\.0\),/g, 'Math.max(0,') +
      (/\breturn\b/.test(body) ? '' : 'return E;'),
  ) as (c: number[], v: Vector) => number;

const between = (text: string, from: string, to: string) => {
  const start = text.indexOf(from) + from.length;
  return text.slice(start, text.indexOf(to, start));
};

test('a bounce probe is read in the band order the environment and the light probe use', () => {
  // Run on the shader text itself, not on the shared basis: the coefficients the probe pass
  // writes for one ray, then the bounce lookup, the WebGPU environment and the WebGL2 light
  // probe reading them must agree on every normal.
  const terms = [...BOUNCE_PROBE_SHADER.matchAll(/sums\[(\d)\]\+=sample\.rgb\*(.+);/g)];
  assert.equal(terms.length, 9);
  const project = (d: Vector) => {
    const sh = new Array<number>(9).fill(0);
    for (const [, k, term] of terms) sh[Number(k)] = new Function('d', `return ${term};`)(d);
    return sh;
  };
  const bounce = channel(
    between(BOUNCE_GRID_WGSL, 'fn shIrradiance(slot:u32,n:vec3f)->vec3f{', '\n}'),
    /probes\[slot(?:\+(\d)u)?\]\.xyz/g,
    'n',
  );
  const environment = channel(
    between(DIRECT_LIGHTING_WGSL, 'let e=directLights.environment;', 'return'),
    /e\[(\d)\]\.rgb/g,
    'N',
  );
  const lightProbe = channel(
    between(PROBE_IRRADIANCE_GLSL, 'vec3 N=viewNormal*viewRotation;', 'return'),
    /probeSh\[(\d)\]/g,
    'N',
  );
  const unit = (x: number, y: number, z: number) => {
    const length = Math.hypot(x, y, z);
    return { x: x / length, y: y / length, z: z / length };
  };
  const directions = [unit(1, 0, 0), unit(0, 1, 0), unit(0.3, -0.5, 0.8), unit(-2, 1, 1)];
  for (const source of directions) {
    const sh = project(source);
    for (const n of [...directions, unit(1, 2, -3)]) {
      const expected = bounce(sh, n);
      for (const read of [environment(sh, n), lightProbe(sh, n)])
        assert.ok(Math.abs(Math.max(0, read) - expected) < 1e-5, `${expected} vs ${read}`);
    }
  }
});
