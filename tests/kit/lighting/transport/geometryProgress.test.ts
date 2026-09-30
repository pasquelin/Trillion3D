import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { sceneWithBlocker } from '../../../fixtures/lightingTransportScene.ts';

test('surface geometry changes invalidate visibility even when contained patch samples stay unchanged', () => {
  const scene = sceneWithBlocker(true, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  state.initialized = true;
  scene.surfaces[0].u[1] = 4.5;
  const events: unknown[] = [];
  assert.deepEqual(
    updateTransportGeometry(state, scene, { onProgress: (event) => events.push(event) }),
    { geometryChanged: true, staticChanged: true },
  );
  assert.ok(state.patchChanged.every((value) => value === 0));
  assert.deepEqual(
    events,
    [0, 3].map((completed) => ({ eventVersion: 1, stage: 'geometry', completed, total: 3 })),
  );
});
