import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { sceneWithBlocker } from '../../../fixtures/lightingTransportScene.ts';

test('unsafe payload arithmetic is rejected before attempting any typed-array allocation', () => {
  const original = globalThis.Float64Array;
  globalThis.Float64Array = new Proxy(original, {
    construct() {
      throw new Error('allocation must not be reached');
    },
  });
  try {
    for (const raysPerPatch of [2 ** 48, 2 ** 52])
      assert.throws(
        () =>
          createTransportState(sceneWithBlocker(false, 1), {
            raysPerPatch,
            maxBytes: Number.MAX_VALUE,
          }),
        (error: any) =>
          error.code === 'MEMORY_BUDGET_EXCEEDED' && error.message.includes('payload exceeds'),
      );
  } finally {
    globalThis.Float64Array = original;
  }
});
