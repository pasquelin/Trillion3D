import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingSceneGeometry, createLightingScenePatches } from './geometry.ts';
import { addLightingSceneObjects } from './objects.ts';

test('area emitters stay centered on controls and retain independent colored power in stable order', () => {
  const geometry = createLightingSceneGeometry(1);
  const lights = ['zzz', 'warm', 'aaa'].map((id) => ({
    id,
    position: [3, 4, 5] as [number, number, number],
    color: [0.5, 0.25, 1] as [number, number, number],
    intensity: 2,
  }));
  addLightingSceneObjects(geometry, lights, 3);
  assert.deepEqual(
    geometry.surfaces.slice(0, 3).map((surface) => surface.id),
    ['ceiling_emitter', 'ceiling_emitter_aaa', 'ceiling_emitter_zzz'],
  );
  for (const surface of geometry.surfaces.slice(0, 3)) {
    assert.deepEqual(surface.emission, [36, 18, 72]);
    assert.deepEqual(surface.albedo, [0.65, 0.65, 0.65]);
    assert.equal(surface.kind, 'diffuse');
    assert.equal(surface.moving, true);
    const patches = createLightingScenePatches([surface]);
    for (let axis = 0; axis < 3; axis++) {
      const average = patches.reduce((sum, patch) => sum + patch.center[axis], 0) / patches.length;
      assert.ok(Math.abs(average - [3, 4, 5][axis]) < 1e-12);
    }
    const area = patches.reduce((sum, patch) => sum + patch.area, 0);
    assert.ok(Math.abs(area - (surface.id === 'ceiling_emitter' ? 3.52 : 0.64)) < 1e-12);
  }
  const mirrors = geometry.surfaces.slice(3);
  assert.ok(mirrors.every((surface) => !surface.moving && surface.kind === 'mirror'));
  assert.ok(mirrors.every((surface) => surface.albedo.every((value) => value > 0.9)));
  const near = createLightingScenePatches([mirrors[0]]);
  assert.ok(near.every((patch) => patch.albedo.every((value) => value === 0)));
  const averageZ = near.reduce((sum, patch) => sum + patch.center[2], 0) / near.length;
  assert.ok(averageZ < 0);
});
