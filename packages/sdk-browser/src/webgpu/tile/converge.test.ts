import test from 'node:test';
import assert from 'node:assert/strict';
import { mustRestartTaaAfterSettle, quietImagesWanted, texturesConverged } from './converge.ts';
import { MAP_CHOICES, PICK_CYCLE } from './feedback.ts';

test('a quiet barrier leaves TAA history in place', () => {
  assert.equal(mustRestartTaaAfterSettle(0, 0), false);
});

test('tiles or shadow pages that landed during the barrier restart the still TAA average', () => {
  assert.equal(mustRestartTaaAfterSettle(1, 0), true);
  assert.equal(mustRestartTaaAfterSettle(0, 3), true);
});

// #1016: a pixel names ONE map, blend level and tap, picked by its position shifted by the
// convergence's turn (`requestPick`). A sliver of a surface — three pixels at the edge of a lamp
// — named nothing it reads, and the settled image read what the pool kept of the run before.
test('a convergence stops only after a whole pick cycle in which every pixel named every read', () => {
  const pick = (px: number, choices: number) => [
    px % choices,
    Math.floor(px / choices) & 1,
    Math.floor(px / choices / 2) % 3,
  ];
  // The shade pass picks among the maps and the masked sun level, the blend pass among the maps.
  for (const choices of [MAP_CHOICES, MAP_CHOICES + 1])
    for (const px of [0, 7, 1280 + 719]) {
      const named = new Set<string>();
      for (let turn = 0; turn < PICK_CYCLE; turn++) named.add(pick(px + turn, choices).join());
      assert.equal(named.size, choices * 2 * 3, `pixel ${px}, ${choices} maps`);
    }
  assert.equal(texturesConverged(PICK_CYCLE - 1, PICK_CYCLE, 0, false), false);
  assert.equal(texturesConverged(PICK_CYCLE, PICK_CYCLE, 0, false), true);
  assert.equal(texturesConverged(PICK_CYCLE, PICK_CYCLE, 2, true), false);
});

// #1016 review: the cycle ran at every barrier round and every flush — `awaitPages` flushes three
// times, 126 images and more per pose. It runs once per pose, at a capture's barrier.
test('the whole pick cycle runs once per pose, at a capture barrier only', () => {
  assert.equal(quietImagesWanted(true, false), PICK_CYCLE, 'first capture of the pose');
  assert.equal(quietImagesWanted(true, true), 1, 'the pose already cycled');
  assert.equal(quietImagesWanted(false, false), 1, 'a wait for pages takes no picture');
  assert.equal(texturesConverged(1, 1, 0, false), true);
});
