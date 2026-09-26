import test from 'node:test';
import assert from 'node:assert/strict';
import { LOD_QUALITY, lodQuality, adaptivePixelError } from './policy.ts';
test('LOD presets are explicit pixel-error configurations', () => {
  assert.equal(lodQuality('source').pixelError, 0);
  assert.equal(LOD_QUALITY.high.pixelError, 1);
  assert.equal(LOD_QUALITY.balanced.pixelError, 4);
  assert.equal(LOD_QUALITY.adaptive.adaptive, true);
  assert.throws(() => lodQuality('nope'));
});
test('adaptive error grows with speed and stays at the base when still', () => {
  assert.equal(adaptivePixelError(2, 0, 10), 2);
  assert.ok(adaptivePixelError(2, 20, 10) > 2);
  assert.ok(adaptivePixelError(2, 1e9, 10) <= 2 * 5);
});
