import test from 'node:test';
import assert from 'node:assert/strict';
import type { RenderBackend } from '../../backend/types.ts';
import { hostFramingCamera } from '../../host/scene/graphObjects.ts';
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { GraphGroup } from '../../host/graph/mesh.ts';
import { createPartitionCells, type PartitionCells } from '../../scene/partition/cells.ts';
import { cellReach } from '../../scene/partition/plan.ts';
import { placedMesh } from '../../scene/partition/rows.ts';
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts';
import type { createPageStreamer } from '../../streaming/pages.ts';
import { createPartitionFrame, primePartitions } from './partitionFrame.ts';

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
  const pebble = {
    url: 'pebble.json',
    sha256: '',
    bytes: 1,
    meshes: [[0, 1] as const],
  };
  const cells = createPartitionCells({
    partition: {
      version: 1,
      bounds: [200, 0, 0, 200.01, 0.01, 0.01],
      meshes: [0],
      cells: [{ ...pebble, parents: [[null, [200, 0, 0, 200.01, 0.01, 0.01]] as const] }],
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

test('a reach past the rows sized at open asks the owner to open the session again', () => {
  const renew = () => {};
  const { cells, seen } = recording();
  createPartitionFrame({
    partitions: [cells],
    streamer: streamer().port,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    active: () => ({}) as RenderBackend,
    renew,
  })!();
  assert.equal(seen[0].io.outgrown, renew);
});

/** A grid of `side`² cells ten metres wide, each placing four nodes of one of two meshes. */
function grid(side: number) {
  const cells: TableCell[] = [];
  const bodies = new Map<string, Uint8Array>();
  for (let x = 0; x < side; x++)
    for (let z = 0; z < side; z++) {
      const url = `https://cache.test/key/cell-${x}-${z}.json`;
      const mesh = (x + z) % 2;
      const nodes = [0, 1, 2, 3].map((at) => ({
        parent: null,
        mesh,
        matrix: null,
        translation: [x * 10 + at * 2, 0, z * 10 + at * 2],
        rotation: null,
        scale: null,
      }));
      bodies.set(url, new TextEncoder().encode(JSON.stringify({ version: 1, nodes })));
      const bounds = [x * 10, 0, z * 10, x * 10 + 8, 1, z * 10 + 8];
      cells.push({ url, sha256: '', bytes: 1, parents: [[null, bounds]], meshes: [[mesh, 4]] });
    }
  const partition = {
    version: 1,
    bounds: [0, 0, 0, side * 10, 1, side * 10],
    meshes: [0, 1],
    cells,
  };
  const meshes = new Map([0, 1].map((rank) => [rank, placedMesh([{ meshes: rank }])]));
  const port = {
    readBytes: async (url: string) => bodies.get(url)!,
    getBytes: (url: string) => bodies.get(url),
    loading: () => false,
    request: async () => {},
  } as unknown as ReturnType<typeof createPageStreamer>;
  const root = new GraphGroup();
  const partitioned = createPartitionCells({
    partition,
    base: 'https://cache.test/key/',
    root,
    parents: [],
    meshes,
  });
  return { partitioned, port };
}

test('on a WebGPU session, which grows no buffer, a walk never leaves a cell waiting for rows', async () => {
  // Its engine cannot grow rows in place, and the reach stays the one the rows were sized for.
  const { partitioned, port } = grid(24);
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 30);
  camera.position.set(5, 2, 5);
  await primePartitions([partitioned], camera, port, true);
  const frame = createPartitionFrame({
    partitions: [partitioned],
    streamer: port,
    camera,
    active: () => ({}) as RenderBackend,
  })!;
  for (let step = 0; step <= 46; step++) {
    camera.position.set(5 + step * 5, 2, 5 + step * 5);
    camera.updateMatrixWorld();
    frame();
    assert.equal(partitioned.stats().waiting, 0, `step ${step}`);
  }
  assert.ok(partitioned.stats().held > 1, 'the cells around the camera are placed');
});
