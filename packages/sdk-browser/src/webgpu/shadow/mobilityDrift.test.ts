// #831: a caster whose pose moves its box by less than a float32 step at its reach is no move, so
// a resting body whose float64 pose is rounded again each step stales no shadow page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowMobility } from './mobility.ts';
import { MOVE_MOVING, MOVE_NONE, MOVE_PROMOTED } from '../../placement/update.ts';

// A resting body's pose rounded again in float64 (a tank's, by 1e-16 each step) is no move: below
// a float32 step at its box's reach, the GPU's world cannot show it. A millimetre is one (#831).
test('a pose that moves its box by less than a float32 step is no move; a millimetre is', () => {
  const mobility = createShadowMobility();
  const box = [-1.8, -0.5, -3.5, 1.8, 0.5, 3.5],
    parked = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 40, 2, -25, 1];
  mobility.ensure(1, 1, () => parked);
  // The engine's route (`../../placement/webgpuPlacements.ts`): weighed once, then taken as a move.
  const pose = (world: number[]) =>
    mobility.holds(0, world, box) ? MOVE_NONE : mobility.move(0, world, true);
  const drifted = parked.map((v, i) => (i === 0 || i === 12 ? v + v * 1e-16 + 1e-15 : v));
  assert.equal(pose(drifted), MOVE_NONE, 'drift: no move');
  const turned = parked.slice();
  [turned[0], turned[2], turned[8], turned[10]] = [Math.cos(1e-9), -1e-9, 1e-9, Math.cos(1e-9)];
  assert.equal(pose(turned), MOVE_NONE, 'a nano-radian turn: no move');
  assert.equal(mobility.moves(0), false, 'the static layer stays whole');
  const shifted = parked.slice();
  shifted[12] += 1e-3;
  assert.equal(pose(shifted), MOVE_PROMOTED, 'a millimetre moves it');
  const spun = shifted.slice();
  [spun[0], spun[2], spun[8], spun[10]] = [
    Math.cos(0.01),
    -Math.sin(0.01),
    Math.sin(0.01),
    Math.cos(0.01),
  ];
  assert.equal(pose(spun), MOVE_MOVING, 'a turn in place moves it');
});
