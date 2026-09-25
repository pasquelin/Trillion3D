import test from 'node:test';
import assert from 'node:assert/strict';
import type { Block } from './docs/observatory/geometry.ts';
import { createObservatory, paving } from './docs/observatory/scene.ts';

const bottom = (block: Block) => block.center[1] - block.size[1] / 2;
const top = (block: Block) => block.center[1] + block.size[1] / 2;

test('each arcade plinth rests on the paving stone under it, centred on it', () => {
  const { blocks } = createObservatory();
  const stones = blocks.filter((block) => block.size.every((side, i) => side === paving.size[i]));
  // A foot: a block narrower than a stone, over one, whose base reaches down to its top.
  const feet = blocks.flatMap((block) => {
    if (block.size[0] >= paving.size[0] || block.size[2] >= paving.size[2]) return [];
    const stone = stones.find((candidate) =>
      [0, 2].every(
        (axis) =>
          Math.abs(block.center[axis] - candidate.center[axis]) <= candidate.size[axis] / 2,
      ),
    );
    return stone && bottom(block) <= top(stone) + 1e-9 && top(block) > top(stone)
      ? [{ block, stone }]
      : [];
  });
  assert.equal(feet.length, 8, 'two arcades of four plinths');
  for (const { block, stone } of feet) {
    const at = `plinth at ${block.center.join(', ')}`;
    assert.ok(Math.abs(bottom(block) - top(stone)) < 1e-9, `${at}: bottom on the stone's top`);
    for (const axis of [0, 2])
      assert.ok(
        Math.abs(block.center[axis] - stone.center[axis]) < 1e-9,
        `${at}: centred on its stone`,
      );
  }
});
