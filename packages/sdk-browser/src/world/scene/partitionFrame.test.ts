import test from 'node:test';
import assert from 'node:assert/strict';
import type { RenderBackend } from '../../backend/types.ts';
import { hostFramingCamera } from '../../host/scene/graphObjects.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { PartitionCells } from '../../scene/partition/cells.ts';
import { cellReach } from '../../scene/partition/plan.ts';
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts';
import type { createPageStreamer } from '../../streaming/pages.ts';
import { createPartitionFrame } from './partitionFrame.ts';

type Io = Parameters<PartitionCells['frame']>[2];

/** Cells that record what a frame hands them, and ask for one cell visible and one ahead. */
function recording() {
  const seen: { eye: number[]; reach: number; io: Io }[] = [];
  const cells = {
    frame(eye: number[], reach: (size: number) => number, io: Io) {
      seen.push({ eye: [...eye], reach: reach(2), io });
      io.request(['near.json'], false);
      io.request(['ahead.json'], true);
    },
  } as unknown as PartitionCells;
  return { cells, seen };
}

function streamer() {
  const asked: [readonly string[], number][] = [];
  const port = {
    request: async (urls: readonly string[], options: { priority: number }) =>
      void asked.push([urls, options.priority]),
    getBytes: () => undefined,
    loading: () => false,
  } as unknown as ReturnType<typeof createPageStreamer>;
  return { port, asked };
}

test('no partition, no step before the frame', () => {
  const frame = createPartitionFrame({
    partitions: [],
    streamer: streamer().port,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    canvas: { height: 720 },
    pixelError: () => 1,
    active: () => ({}) as RenderBackend,
  });
  assert.equal(frame, null);
});

test('a frame reads the camera, the drawn height and the error of the moment', () => {
  const { cells, seen } = recording();
  const { port, asked } = streamer();
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 500);
  camera.position.set(3, 4, 5);
  let error = 1;
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer: port,
    camera,
    canvas: { height: 1080 },
    pixelError: () => error,
    active: () => ({}) as RenderBackend,
  })!;
  frame();
  error = 4;
  frame();
  assert.deepEqual(seen[0].eye, [3, 4, 5]);
  assert.deepEqual(
    seen.map(({ reach }) => reach),
    [1, 4].map((target) => cellReach(2, camera, 1080, target)),
  );
  assert.deepEqual(asked.slice(0, 2), [
    [['near.json'], PRIORITY_VISIBLE],
    [['ahead.json'], PRIORITY_PREFETCH],
  ]);
});

test('rows grow in the engine that can, and open the session again where it cannot', () => {
  const rows = {} as PlacementRows;
  const grown: PlacementRows[] = [];
  let renewed = 0;
  for (const backend of [
    { growPlacements: (_from: PlacementRows, to: PlacementRows) => void grown.push(to) },
    {},
  ]) {
    const { cells, seen } = recording();
    createPartitionFrame({
      partitions: [cells],
      streamer: streamer().port,
      camera: hostFramingCamera(60, 1, 0.1, 100),
      canvas: { height: 720 },
      pixelError: () => 1,
      active: () => backend as unknown as RenderBackend,
      renew: () => void renewed++,
    })!();
    seen[0].io.grow!(rows, rows);
  }
  assert.deepEqual([grown, renewed], [[rows], 1]);
});
