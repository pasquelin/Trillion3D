import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsPoses } from './poses.ts';
import { records, seated } from './seatedPoses.fixture.ts';

/** Every row the frame drew is finite: a non-finite one stops the renderer ("Invalid matrix"). */
function assertFinite(matrices: Float64Array, label: string) {
  assert.ok(matrices.every(Number.isFinite), `${label}: ${[...matrices.subarray(0, 16)]}`);
}

test('a page clock that steps back draws every body at a finite pose', (t) => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const { scene, batch, meshes, bodies } = seated(2);
  const poses = createPhysicsPoses(2, scene);
  // A slow-motion tick drawn over 66 ms; frames on and past it, then the clock 40 ms back.
  poses.receive(records(2, 1, 2), 2, bodies, 66);
  for (const time of [30, 70, 30, 10, 90, 50]) {
    clock = time;
    poses.apply(bodies);
    assertFinite(batch.rows.matrices, `frame at ${time} ms`);
  }
  // Time never ran back for the drawn poses: the body is held where it was drawn, never behind.
  assert.ok(meshes[0].position.y >= 1, 'on or past its target');
});

test('a page clock standing still while ticks arrive draws every body at a finite pose', (t) => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const { scene, batch, bodies } = seated(1);
  const poses = createPhysicsPoses(1, scene);
  poses.receive(records(1, 1, 2), 1, bodies, 16);
  clock = 16;
  // Ticks at no page time apart shrink the span they are drawn over to nothing.
  for (let tick = 0; tick < 2500; tick++) {
    poses.receive(records(1, 1 + tick / 100, 2), 1, bodies, 16);
    poses.apply(bodies);
  }
  assertFinite(batch.rows.matrices, 'still');
  // The clock runs on: the last tick is drawn and extrapolated, one tick ahead at most.
  clock += 30;
  poses.apply(bodies);
  assertFinite(batch.rows.matrices, 'running again');
});
