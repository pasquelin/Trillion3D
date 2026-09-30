import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from './transport.ts';
import { sceneWithBlocker } from '../../../../../tests/fixtures/lightingTransportScene.ts';

test('transport exposes elapsed stage timing and snapshots own all their buffers', () => {
  const scene = sceneWithBlocker(true, 1);
  const times = [10, 13, 18, 20, 21, 23];
  const transport = createTransport(scene, { raysPerPatch: 4, now: () => times.shift()! });
  assert.throws(() => transport.snapshot(), /Update transport successfully/);
  const first = transport.update(scene, 'rebuild');
  assert.deepEqual(first.timings, { rayTraceMs: 3, solveMs: 5, totalMs: 8 });
  assert.equal(first.raysReused, 0);
  const saved = transport.snapshot();
  const independent = structuredClone(saved);
  saved.source.fill(99);
  saved.albedo.fill(0.99);
  saved.matrix.fill(0.99);
  assert.deepEqual(transport.snapshot(), independent);
  const second = transport.update(scene, 'reuse');
  assert.deepEqual(second.timings, { rayTraceMs: 1, solveMs: 2, totalMs: 3 });
  assert.equal(second.raysReused, second.totalRays);
});

test('invalid update mode and scene fail before a snapshot can be published', () => {
  const scene = sceneWithBlocker(true, 1);
  for (const scenario of ['mode', 'scene']) {
    const transport = createTransport(scene, { raysPerPatch: 4 });
    transport.update(scene, 'rebuild');
    const changed = structuredClone(scene);
    if (scenario === 'scene') changed.patches[0].area = -1;
    assert.throws(
      () => transport.update(changed, scenario === 'mode' ? ('other' as any) : 'reuse'),
      (error: any) =>
        error.code === (scenario === 'mode' ? 'INVALID_OPTIONS' : 'INVALID_SCENE') &&
        error.message.length > 10,
    );
    assert.throws(() => transport.snapshot(), /Update transport successfully/);
  }
});
