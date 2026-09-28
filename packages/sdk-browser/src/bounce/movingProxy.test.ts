import test from 'node:test';
import assert from 'node:assert/strict';
import { createBounceCascades, BOUNCE_SETTINGS } from '../../../sdk-core/src/index.ts';
import { createBounceSchedule } from './schedule.ts';
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts';
import { BOUNCE_SURFACE_SHADER } from './surfaceWgsl.ts';
import { BOUNCE_LIGHTING_SHADER } from '../lighting/deferred/shaders.ts';
import { WATER_COMPOSITE_SHADER } from '../webgpu/water/compositeWgsl.ts';
import { SURFACE_IRRADIANCE_WGSL } from './irradianceWgsl.ts';
import { functionText } from './wgslBody.fixture.ts';
import type { BounceOccupancy } from '../../../sdk-core/src/index.ts';

test('expanded cascade extent schedules every new level without growing the queue', () => {
  const cascades = createBounceCascades([0, 0, 0, 1, 1, 1]);
  const occupancy = { occupied: () => true } as unknown as BounceOccupancy;
  const schedule = createBounceSchedule(cascades, occupancy);
  const queue = schedule.queue;
  const initial = cascades.levels.length;
  assert.equal(cascades.replan([0, 0, 0, 100000, 100000, 100000]), true);
  assert.ok(cascades.levels.length >= initial);
  assert.ok(cascades.probes <= cascades.reserveCount);
  schedule.restart();
  const count = schedule.plan(BOUNCE_SETTINGS.cascadeLevels);
  const levels = new Set(
    Array.from(queue.subarray(0, count), (rank) => Math.floor(rank / cascades.probesPerLevel)),
  );
  assert.equal(levels.size, cascades.levels.length);
  assert.equal(schedule.queue, queue);
  assert.equal(cascades.replan([100, 0, 0, 100100, 100000, 100000]), false);
  assert.equal(
    cascades.invalidLevels,
    0,
    'translation preserves the lattice and accumulated probes',
  );
});

test('moving hit radiance evaluates the actual owner before any canonical cache read', () => {
  for (const shader of [BOUNCE_PROBE_SHADER, BOUNCE_LIGHTING_SHADER, WATER_COMPOSITE_SHADER]) {
    const ray = functionText(shader, 'rayRadiance');
    assert.match(ray, /proxyOwnerCentre\(hit.triangle,hit.owner\)/);
    assert.match(ray, /proxyOwnerAlbedo\(hit.owner\)\*lighting\*INVERSE_PI/);
    assert.ok(ray.indexOf('if(proxy.dynamic!=0u)') < ray.indexOf('surface[texel]'));
    assert.equal(shader.split(SURFACE_IRRADIANCE_WGSL).length - 1, 1);
  }
  assert.ok(BOUNCE_SURFACE_SHADER.includes(SURFACE_IRRADIANCE_WGSL));
});

test('moving traversal retains owner identity and visits the complete finite refitted tree', () => {
  for (const name of ['traceProxy', 'proxyBlocked']) {
    const body = functionText(BOUNCE_PROBE_SHADER, name);
    assert.match(body, /select\(TRAVERSAL_STEPS,proxyNodeCount\(\),proxy.dynamic!=0u\)/);
    assert.match(body, /for\(var owner=owners.x;owner<end;owner\+\+\)/);
    assert.match(body, /triangleHit\(index,owner,/);
  }
  assert.match(
    functionText(BOUNCE_PROBE_SHADER, 'traceProxy'),
    /ProxyHit\(distance,index,owner,true\)/,
  );
});
