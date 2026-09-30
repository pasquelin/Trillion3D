import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { updateTransportVisibility } from './visibility.ts';
import { sceneWithBlocker } from '../../../../../tests/fixtures/lightingTransportScene.ts';

test('visibility reports final progress and clamps hits on the outer surface edge', () => {
  const scene = sceneWithBlocker(true, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  for (let ray = 0; ray < state.totalRays; ray++) state.rays.set([0.01, 2, -2, 1, 0, 0], ray * 6);
  const events: unknown[] = [];
  updateTransportVisibility(
    state,
    scene,
    'rebuild',
    { onProgress: (event) => events.push(event) },
    true,
    true,
  );
  assert.ok(state.firstHit.every((value) => value === 7));
  assert.deepEqual(
    events,
    [0, 9].map((completed) => ({ eventVersion: 1, stage: 'visibility', completed, total: 9 })),
  );
});
