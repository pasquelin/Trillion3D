import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingScene } from './experimentScene.ts';
import { validateScene } from '../transport/validation.ts';

test('room surfaces keep valid materials, inward faces subdivided and slab thickness outside the room', () => {
  const scene = createLightingScene({ doorAngle: 0, lightIntensity: 1, patchSize: 0.5 });
  assert.doesNotThrow(() => validateScene(scene));
  for (const surface of scene.surfaces) {
    assert.equal(surface.albedo.length, 3);
    assert.equal(surface.emission.length, 3);
    assert.ok(['diffuse', 'mirror'].includes(surface.kind));
    const patches = scene.patches.filter((patch) => scene.surfaces[patch.surface] === surface);
    if (surface.id.startsWith('floor_')) assert.ok(patches.every((patch) => patch.center[1] <= 0));
    if (surface.id.startsWith('ceiling_') && !surface.id.startsWith('ceiling_emitter'))
      assert.ok(patches.every((patch) => patch.center[1] >= 3));
    if (surface.id.startsWith('west_wall'))
      assert.ok(patches.every((patch) => patch.center[0] <= -4));
    if (surface.id.startsWith('east_wall'))
      assert.ok(patches.every((patch) => patch.center[0] >= 4));
  }
  for (const id of [
    'floor_left_py',
    'floor_right_py',
    'floor_threshold_py',
    'west_wall_px',
    'east_wall_nx',
  ]) {
    const surface = scene.surfaces.find((item) => item.id === id)!;
    const patches = scene.patches.filter((patch) => scene.surfaces[patch.surface] === surface);
    assert.ok(patches.length > 1, id);
    assert.ok(
      patches.every((patch) => patch.area <= 0.25),
      id,
    );
  }
});
