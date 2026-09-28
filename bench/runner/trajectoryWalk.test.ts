import assert from 'node:assert/strict';
import test from 'node:test';
import { walkTrajectory } from './trajectoryWalk.ts';
import { poseAt } from './poses.ts';
import type { FrameMetrics } from '../../packages/sdk-core/src/index.ts';

const pose = poseAt({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } }, 0);
test('arrival counters survive a backend reusing its metrics scratch during settling', async () => {
  const scratch: Partial<FrameMetrics> = {
    selectedTriangles: 10,
    drawnTriangles: 10,
    uncoveredTriangles: 0,
  };
  let renders = 0;
  const result = await walkTrajectory(
    {
      nextFrame: async () => {},
      render: () => {
        scratch.pagesRequested = scratch.residentPages = ++renders;
        scratch.frameHeld = renders !== 2;
        return scratch;
      },
      capture: async (name) => name,
    },
    [pose],
    [0],
    'candidate',
    true,
  );
  assert.equal(renders, 3);
  assert.equal(scratch.pagesRequested, 3);
  assert.equal(result.checkpoints[0].pagesRequested, 2);
  assert.equal(result.checkpoints[0].residentPages, 2);
});

test('arrival precedes convergence and temporary holes/errors remain failures after recovery', async () => {
  let renders = 0,
    ticks = 0;
  const captures: number[] = [];
  const result = await walkTrajectory(
    {
      nextFrame: async () => {
        ticks++;
      },
      render: () => {
        renders++;
        return {
          frameHeld: renders === 1 || renders === 5,
          selectedTriangles: 10,
          drawnTriangles: renders === 3 ? 9 : 10,
          uncoveredTriangles: renders === 3 ? 1 : 0,
          streamingError: renders === 4 ? 'temporary failure' : null,
        };
      },
      capture: async (name) => {
        captures.push(renders);
        return name;
      },
    },
    [pose],
    [0],
    'candidate',
    true,
  );
  assert.deepEqual(
    captures,
    [2, 5],
    'arrival captures the moving render, before any settle render',
  );
  assert.deepEqual(result.coverageFailures, [0]);
  assert.deepEqual(result.incidents, ['temporary failure']);
  assert.equal(result.checkpoints[0].settleFrames, 3);
  assert.equal(ticks, renders, 'all renders, including settling, advance through browser frames');
});

test('intermediate moving poses render once and an unsettled checkpoint stays bounded', async () => {
  let renders = 0;
  const result = await walkTrajectory(
    {
      nextFrame: async () => {},
      render: () => ({
        frameHeld: ++renders === 1,
        selectedTriangles: 10,
        drawnTriangles: 10,
        uncoveredTriangles: 0,
      }),
      capture: async (name) => name,
    },
    [pose, pose, pose],
    [2],
    'candidate',
    true,
  );
  assert.equal(renders, 1 + 3 + 64);
  assert.equal(result.checkpoints[0].settleFrames, null);
  assert.deepEqual(result.coverageFailures, []);
});
