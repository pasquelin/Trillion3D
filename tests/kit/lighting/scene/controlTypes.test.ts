import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLightingSceneControls } from './controls.ts';

test('panel ids must be strings rather than values whose coercion happens to resemble a valid id', () => {
  for (const id of [null, undefined, true, { toString: () => 'valid_panel' }])
    assert.throws(
      () =>
        validateLightingSceneControls(0, 1, 1, 0.5, {
          lights: [{ id, color: [1, 1, 1], intensity: 1, position: [0, 2, 0] }],
        } as any),
      /Invalid lighting scene area panel/,
    );
});
