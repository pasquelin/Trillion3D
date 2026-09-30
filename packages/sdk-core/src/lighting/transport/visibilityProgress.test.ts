import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { updateTransportVisibility } from './visibility.ts';
import {
  sceneFromSurfaces,
  sceneWithBlocker,
} from '../../../../../tests/fixtures/lightingTransportScene.ts';

test('visibility publishes intermediate row progress before the final partial block', () => {
  const surface = sceneWithBlocker(true, 1).surfaces[0];
  const scene = sceneFromSurfaces([{ ...surface, columns: 17, rows: 1 }]);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  const events: unknown[] = [];
  updateTransportVisibility(
    state,
    scene,
    'rebuild',
    { onProgress: (event) => events.push(event) },
    true,
    true,
  );
  assert.ok(state.staticHit.every((value) => value === -1));
  assert.ok(state.staticUv.every((value) => value === -1));
  assert.deepEqual(
    events,
    [0, 16, 17].map((completed) => ({
      eventVersion: 1,
      stage: 'visibility',
      completed,
      total: 17,
    })),
  );
});

test('visibility honors a cancellation request during a large row before tracing its remaining rays', () => {
  const surface = sceneWithBlocker(true, 1).surfaces[0];
  const scene = sceneFromSurfaces([{ ...surface, columns: 1, rows: 1 }]);
  const state = createTransportState(scene, { raysPerPatch: 1024 });
  updateTransportGeometry(state, scene, {});
  state.firstHit.fill(-99);
  assert.throws(
    () =>
      updateTransportVisibility(
        state,
        scene,
        'rebuild',
        {
          cancelled: () => state.firstHit[0] !== -99,
        },
        true,
        true,
      ),
    (error: any) => error.code === 'CANCELLED',
  );
  assert.ok(state.firstHit.slice(0, 256).every((value) => value === -1));
  assert.ok(state.firstHit.slice(256).every((value) => value === -99));
});
