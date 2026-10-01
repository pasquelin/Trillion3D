import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNCE_PROBES_PER_FRAME, BOUNCE_SETTINGS } from './contracts.ts';

test('a frame updates as many probes as the ray ceiling holds, and no more', () => {
  const { raysPerProbe, raysPerFrame } = BOUNCE_SETTINGS;
  assert.ok(Number.isInteger(BOUNCE_PROBES_PER_FRAME));
  assert.ok(BOUNCE_PROBES_PER_FRAME * raysPerProbe <= raysPerFrame, 'within the ceiling');
  assert.ok((BOUNCE_PROBES_PER_FRAME + 1) * raysPerProbe > raysPerFrame, 'one more would pass it');
});
