import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { sceneWithBlocker } from '../../../fixtures/lightingTransportScene.ts';

test('transport state rejects each invalid allocation option before allocating arrays', () => {
  const scene = sceneWithBlocker(false, 1);
  const invalid = {
    raysPerPatch: [0, -4, 2, 5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1],
    maxIterations: [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1],
    tolerance: [0, -1, NaN, Infinity],
    maxBytes: [0, -1, NaN, Infinity],
  };
  for (const [field, values] of Object.entries(invalid))
    for (const value of values)
      assert.throws(
        () => createTransportState(scene, { [field]: value }),
        (error: any) => error.code === 'INVALID_OPTIONS' && error.message.includes('Invalid ray'),
      );
  assert.doesNotThrow(() => createTransportState(scene, { raysPerPatch: 4, maxIterations: 1 }));
  const broken = structuredClone(scene);
  broken.patches[0].area = -1;
  assert.throws(
    () => createTransportState(broken, {}),
    (error: any) => error.code === 'INVALID_SCENE',
  );
});

test('transport payload accounting matches owned arrays and clock follows the selected provider', () => {
  const scene = sceneWithBlocker(false, 1);
  const state = createTransportState(scene, {});
  const buffers = Object.values(state).filter((value) => ArrayBuffer.isView(value));
  assert.equal(
    state.bytes,
    buffers.reduce((sum, value) => sum + value.byteLength, 0),
  );
  assert.equal(state.raysPerPatch, 64);
  assert.equal(state.maxIterations, 256);
  assert.equal(state.tolerance, 1e-7);
  const before = performance.now();
  assert.ok(state.now() >= before);
  assert.ok(state.now() <= performance.now());
  assert.equal(createTransportState(scene, { now: () => 42 }).now(), 42);
  assert.doesNotThrow(() => createTransportState(scene, { maxBytes: state.bytes }));
  assert.throws(
    () => createTransportState(scene, { maxBytes: state.bytes - 1 }),
    (error: any) =>
      error.code === 'MEMORY_BUDGET_EXCEEDED' &&
      error.message.includes('typed-array payload exceeds'),
  );
  assert.throws(
    () => createTransportState(scene, { raysPerPatch: 2 ** 52 }),
    (error: any) => error.code === 'MEMORY_BUDGET_EXCEEDED',
  );
});
