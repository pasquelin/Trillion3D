import test from 'node:test';
import assert from 'node:assert/strict';
import { createBounceCascades, BOUNCE_SETTINGS } from '../../../sdk-core/src/index.ts';
import { createBounceSchedule } from './schedule.ts';
import { proxyMotionSteps } from './proxy.ts';
import type { BounceOccupancy } from '../../../sdk-core/src/index.ts';

// Moving owners are traced on the GPU: `tests/browser/probes/moving-proxy-gpu.ts`.
test('a moved proxy walks the still bound plus its widened nodes, never past a complete walk', () => {
  const still = BOUNCE_SETTINGS.traversalSteps;
  assert.equal(proxyMotionSteps(1_000_000, 0), still, 'nothing widened: the still bound');
  assert.equal(proxyMotionSteps(1_000_000, 12), still + 12, 'a door pays its ancestors');
  assert.equal(proxyMotionSteps(1_000_000, 900_000), still + 900_000, 'no guessed ceiling');
  assert.equal(proxyMotionSteps(40, 3), 40, 'a complete walk is the cap');
});
test('expanded cascade extent schedules every new level without growing the queue', () => {
  const cascades = createBounceCascades([0, 0, 0, 1, 1, 1]);
  const occupancy = { occupied: () => true } as unknown as BounceOccupancy;
  const schedule = createBounceSchedule(cascades, occupancy);
  const queue = schedule.queue;
  const initial = cascades.levels.length;
  assert.equal(cascades.replan([0, 0, 0, 100000, 100000, 100000]), true);
  assert.ok(cascades.levels.length >= initial);
  assert.ok(cascades.probes <= cascades.reserveCount);
  schedule.restart();
  const count = schedule.plan(BOUNCE_SETTINGS.cascadeLevels);
  const levels = new Set(
    Array.from(queue.subarray(0, count), (rank) => Math.floor(rank / cascades.probesPerLevel)),
  );
  assert.equal(levels.size, cascades.levels.length);
  assert.equal(schedule.queue, queue);
  assert.equal(cascades.replan([100, 0, 0, 100100, 100000, 100000]), false);
  assert.equal(
    cascades.invalidLevels,
    0,
    'translation preserves the lattice and accumulated probes',
  );
});
