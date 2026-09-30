import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTransportOracle } from './oracle.ts';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { updateTransportVisibility } from './visibility.ts';
import { sceneWithBlocker } from '../../../fixtures/lightingTransportScene.ts';

test('a cancellation request during oracle setup prevents progress publication', () => {
  let polls = 0;
  const events: unknown[] = [];
  assert.throws(
    () =>
      solveTransportOracle(
        {
          formatVersion: 1,
          algorithmVersion: 'cosine-first-hit-v1',
          patchCount: 1,
          matrix: new Float64Array([0]),
          source: new Float64Array([1, 2, 3]),
          albedo: new Float64Array([0, 0, 0]),
        },
        { cancelled: () => ++polls >= 2, onProgress: (event) => events.push(event) },
      ),
    (error: any) => error.code === 'CANCELLED',
  );
  assert.deepEqual(events, []);
});

test('visibility cancellation requested before ray work leaves every cached hit untouched', () => {
  const scene = sceneWithBlocker(true, 1);
  const state = createTransportState(scene, { raysPerPatch: 4 });
  updateTransportGeometry(state, scene, {});
  state.firstHit.fill(-99);
  let polls = 0;
  assert.throws(
    () =>
      updateTransportVisibility(
        state,
        scene,
        'rebuild',
        {
          cancelled: () => ++polls >= 4,
        },
        true,
        true,
      ),
    (error: any) => error.code === 'CANCELLED',
  );
  assert.ok(state.firstHit.every((value) => value === -99));
});
