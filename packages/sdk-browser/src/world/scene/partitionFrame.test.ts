import test from 'node:test';
import assert from 'node:assert/strict';
import type { RenderBackend } from '../../backend/types.ts';
import { hostFramingCamera } from '../../host/scene/graphObjects.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { GraphGroup } from '../../host/graph/mesh.ts';
import { createPartitionCells, type PartitionCells } from '../../scene/partition/cells.ts';
import { cellReach } from '../../scene/partition/plan.ts';
import { placedMesh } from '../../scene/partition/rows.ts';
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts';
import type { createPageStreamer } from '../../streaming/pages.ts';
import { createPartitionFrame } from './partitionFrame.ts';

type Io = Parameters<PartitionCells['frame']>[2];

/** Cells that record what a frame hands them, and ask for one cell visible and one ahead. */
function recording() {
  const seen: { eye: number[]; reach: number; io: Io }[] = [];
  const cells = {
    frame(eye: number[], reach: number, io: Io) {
      seen.push({ eye: [...eye], reach, io });
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
    active: () => ({}) as RenderBackend,
  });
  assert.equal(frame, null);
});

test('a frame reads the cells within the far plane of its camera, visible first then ahead', () => {
  const { cells, seen } = recording();
  const { port, asked } = streamer();
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 500);
  camera.position.set(3, 4, 5);
  createPartitionFrame({
    partitions: [cells],
    streamer: port,
    camera,
    active: () => ({}) as RenderBackend,
  })!();
  assert.deepEqual(seen[0].eye, [3, 4, 5]);
  assert.equal(seen[0].reach, cellReach(camera));
  assert.deepEqual(asked, [
    [['near.json'], PRIORITY_VISIBLE],
    [['ahead.json'], PRIORITY_PREFETCH],
  ]);
});

test('a pebble far below any error target is read while the far plane lets it be drawn', () => {
  // Nothing coarser stands for an unread cell before #23: a small object within the far plane is
  // read whatever it projects to, or it would be missing from the image for good.
  const pebble = { url: 'pebble.json', sha256: '', bytes: 1, nodes: 1, size: 0.01 };
  const cells = createPartitionCells({
    partition: {
      version: 1,
      bounds: [200, 0, 0, 200.01, 0.01, 0.01],
      meshes: [0],
      cells: [{ ...pebble, bounds: [200, 0, 0, 200.01, 0.01, 0.01] }],
    },
    base: 'https://cache.test/key/',
    root: new GraphGroup(),
    parents: [],
    meshes: new Map([[0, placedMesh([{ meshes: 0, primitives: 0 }])]]),
  });
  const { port, asked } = streamer();
  createPartitionFrame({
    partitions: [cells],
    streamer: port,
    camera: hostFramingCamera(60, 16 / 9, 0.1, 300),
    active: () => ({}) as RenderBackend,
  })!();
  assert.deepEqual(asked, [[['https://cache.test/key/pebble.json'], PRIORITY_VISIBLE]]);
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
      active: () => backend as unknown as RenderBackend,
      renew: () => void renewed++,
    })!();
    seen[0].io.grow!(rows, rows);
  }
  assert.deepEqual([grown, renewed], [[rows], 1]);
});
