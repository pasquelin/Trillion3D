// #1345, PR #1359's first risk: a pool held at its ceiling — the scene asks more than it can grow
// to — under a still view keeps what the view asked since it rested. The jitter phases no longer
// evict and map each other's pages every frame: what they ask past the pool is refused, reads the
// coarser page, and the image rests. Run from the shipped WGSL over a mock device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUN,
  VIEW,
  planFrame,
  sunPages,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { gpuFrames } from './gpuFrames.fixture.ts';
import { session } from './poolResize.fixture.ts';
import { shadowKeptFrom } from './poolResize.ts';

test('a pool held at its ceiling keeps, under a still view, what the view asked since it rested', async () => {
  const s = await session(),
    { lights } = s;
  // The pool grows to its ceiling, and the next report asks past it again.
  await s.ask(6000);
  await s.ask(6000);
  assert.equal(lights.plan.resting, true, 'the view rests');
  assert.equal(shadowKeptFrom(lights, 40), 40);
  assert.equal(shadowKeptFrom(lights, 41), 40, 'what it asked since it rested is kept');
  // The view moves: the latest frame's asks alone are kept, as a pool that can grow keeps them.
  planFrame(lights.plan, lights.store, 42, { ...VIEW, position: [3, 2, 1] });
  assert.equal(shadowKeptFrom(lights, 42), 42);
  await s.ask(100);
  assert.equal(lights.plan.resting, true);
  assert.equal(shadowKeptFrom(lights, 50), 50, 'a demand the pool holds evicts as before');
});

test('kept, a still view’s second jitter phase takes none of the first one’s pages', async () => {
  const run = gpuFrames(4, [SUN]),
    { plan, store, owner } = run,
    none = () => {};
  await run.frame(1, VIEW, [], none);
  const free = [...owner].filter((entry) => entry < 0).length,
    slice = store.sliceOf(0),
    level = plan.sun.finest[slice] + 4;
  assert.ok(free >= 4, `${free} pages free beside the floors`);
  const phase = (row: number) =>
    sunPages(
      plan,
      slice,
      level,
      Array.from({ length: free }, (_, i) => [i - 8, row]),
    );
  const [first, second] = [phase(0), phase(1)];
  await run.frame(2, VIEW, [], none, first);
  assert.equal(run.refused(), 0, 'the first phase fills the pool');
  const held = [...owner];
  // At rest since frame 2, the second phase is refused: no page is evicted, none mapped again.
  await run.frame(3, VIEW, [], none, second, 2);
  assert.deepEqual([...owner], held);
  assert.equal(run.refused(), free);
  // Not held, it evicts the first phase's pages, as before.
  await run.frame(4, VIEW, [], none, second);
  assert.equal([...owner].filter((entry) => second.includes(entry)).length, free);
});
