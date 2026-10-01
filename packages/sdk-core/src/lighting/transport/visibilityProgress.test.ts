import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { updateTransportVisibility } from './visibility.ts';
import type { TransportProgress } from './contracts.ts';
import {
  sceneFromSurfaces,
  sceneWithBlocker,
} from '../../../../../tests/fixtures/lightingTransportScene.ts';

test('visibility reports progress from zero to every row, now and then between them', () => {
  const surface = sceneWithBlocker(true, 1).surfaces[0];
  const scene = sceneFromSurfaces([{ ...surface, columns: 17, rows: 1 }]);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  const events: TransportProgress[] = [];
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
  const done = events.map((event) => event.completed);
  assert.ok(events.every((event) => event.stage === 'visibility' && event.total === state.size));
  assert.deepEqual([done[0], done.at(-1)], [0, state.size]);
  assert.ok(done.every((value, i) => i === 0 || value > done[i - 1]));
  assert.ok(
    done.some((value) => value > 0 && value < state.size),
    `${done}`,
  );
  // Progress is a summary: far fewer events than rows.
  assert.ok(events.length < state.size, `${events.length}`);
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
  // The row stopped part-way: its first rays were traced, its last one never was.
  assert.equal(state.firstHit[0], -1);
  assert.equal(state.firstHit.at(-1), -99);
});

test('a cancellation requested at the start of visibility leaves every cached hit untouched', () => {
  const scene = sceneWithBlocker(true, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  state.firstHit.fill(-99);
  let requested = false;
  assert.throws(
    () =>
      updateTransportVisibility(
        state,
        scene,
        'rebuild',
        {
          cancelled: () => requested,
          onProgress: () => {
            requested = true;
          },
        },
        true,
        true,
      ),
    (error: any) => error.code === 'CANCELLED',
  );
  assert.ok(state.firstHit.every((value) => value === -99));
});
