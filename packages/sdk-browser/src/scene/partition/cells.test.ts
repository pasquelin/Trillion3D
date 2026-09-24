import test from 'node:test';
import assert from 'node:assert/strict';
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { GraphGroup } from '../../host/graph/mesh.ts';
import { GraphNode } from '../../host/graph/node.ts';
import { pose } from '../../host/prepared/nodes.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { createPartitionCells, type PartitionCells } from './cells.ts';

type PartitionIo = Parameters<PartitionCells['frame']>[2];
import { placedMesh, type RowLink } from './rows.ts';

/** Two cells of one mesh, one near the origin and one 5 km away; the second hangs under a moved
 *  core node. */
function world() {
  const node = (x: number, parent: number | null) => ({
    parent,
    mesh: 7,
    matrix: null,
    translation: [x, 1, 2],
    rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    scale: [2, 2, 2],
  });
  const bodies: Record<string, unknown> = {
    'near.json': { version: 1, nodes: [node(1, null), node(3, null)] },
    'far.json': { version: 1, nodes: [node(5000, 0)] },
  };
  const partition: TablePartition = {
    version: 1,
    bounds: [0, 0, 0, 5010, 5, 5],
    meshes: [7],
    cells: [
      {
        url: 'near.json',
        sha256: '',
        bytes: 1,
        parents: [[null, [0, 0, 0, 5, 5, 5]]],
        meshes: [[7, 2]],
      },
      {
        url: 'far.json',
        sha256: '',
        bytes: 1,
        parents: [[0, [5000, -10, 0, 5010, -5, 5]]], // under the core node, 10 m up
        meshes: [[7, 1]],
      },
    ],
  };
  const root = new GraphGroup();
  const core = new GraphNode();
  core.position.set(0, 10, 0);
  root.add(core);
  const links: RowLink[] = [
    { meshes: 7, primitives: 0 },
    { meshes: 7, primitives: 1 },
  ];
  const cells = createPartitionCells({
    partition,
    base: 'https://cache.test/key/',
    root,
    parents: [core],
    meshes: new Map([[7, placedMesh(links)]]),
  });
  const bytes = (url: string) =>
    new TextEncoder().encode(JSON.stringify(bodies[url.split('/').at(-1)!]));
  return { cells, links, root, core, bytes, node };
}

/** An io that holds every cell already read, records what it is asked and each time the reach
 *  outgrew the rows. */
function io(bytes: (url: string) => Uint8Array) {
  const asked: string[] = [],
    updates: [PlacementRows, number, number][] = [];
  const held = new Set<string>();
  const outgrown = { count: 0 };
  const port: PartitionIo = {
    bytes: (url) => (held.has(url) ? bytes(url) : undefined),
    loading: () => false,
    request: (urls) => void asked.push(...urls),
    update: (rows, from, to) => updates.push([rows, from, to]),
    outgrown: () => void outgrown.count++,
  };
  return { port, asked, updates, held, outgrown };
}

/** A reach past both cells. */
const everywhere = 1e5;
/** Opens a session on `cells` for `reach` from far away, an owner to open it again unless
 *  `owned` is false: its rows are sized, no cell is read. */
const opened = (cells: PartitionCells, reach: number, owned = true) =>
  cells.prime([1e9, 0, 0], reach, () => Promise.reject(new Error('nothing is read')), owned);
/** No arrival budget: what a test places never depends on the time the machine takes. */
const noBudget = Infinity;
const row = (rows: PlacementRows, at: number) => [...rows.matrices.subarray(at * 16, at * 16 + 16)];

test('the cells a camera needs are asked nearest first, then placed on rows once read', async () => {
  const { cells, links, bytes } = world();
  const { port, asked, updates, held } = io(bytes);
  await opened(cells, everywhere);
  cells.frame([6000, 0, 0], everywhere, port, noBudget);
  assert.deepEqual(asked, ['https://cache.test/key/far.json', 'https://cache.test/key/near.json']);
  assert.deepEqual(cells.stats(), { cells: 2, held: 0, waiting: 0, rows: 3 });
  asked.forEach((url) => held.add(url));
  cells.frame([6000, 0, 0], everywhere, port, noBudget);
  assert.equal(cells.stats().held, 2);
  for (const link of links) assert.deepEqual([...link.placements!.live.subarray(0, 3)], [1, 1, 1]);
  assert.ok(updates.length >= 2, 'the session is told which rows were written');
});

test('a row holds the world matrix the engine composes for the same node under its parent', async () => {
  const { cells, links, core, bytes, node } = world();
  const { port, held } = io(bytes);
  await opened(cells, everywhere);
  ['near.json', 'far.json'].forEach((name) => held.add(`https://cache.test/key/${name}`));
  cells.frame([0, 0, 0], everywhere, port, noBudget);
  const child = new GraphNode();
  pose(child, node(5000, 0));
  core.add(child);
  const expected = [...hostWorldChainInto(new Float64Array(16), child)];
  const rows = links[1].placements!;
  const at = [0, 1, 2].find((index) => row(rows, index)[12] === expected[12])!;
  assert.deepEqual(row(rows, at), expected, 'the same bits as a host node there');
  // The parent moves: the rows under it follow before the next frame.
  core.position.set(0, 20, 0);
  cells.frame([0, 0, 0], everywhere, port, noBudget);
  assert.deepEqual(row(rows, at), [...hostWorldChainInto(new Float64Array(16), child)]);
});

test('a cell past its reach gives its rows back, parked, for the next cell to take', async () => {
  const { cells, links, bytes } = world();
  const { port, held, updates } = io(bytes);
  await opened(cells, everywhere);
  ['near.json', 'far.json'].forEach((name) => held.add(`https://cache.test/key/${name}`));
  cells.frame([0, 0, 0], everywhere, port, noBudget);
  updates.length = 0;
  cells.frame([0, 0, 0], 100, port, noBudget);
  assert.equal(cells.stats().held, 1, 'the far cell left');
  const live = links[0].placements!.live;
  assert.equal(
    live.reduce((sum, flag) => sum + flag, 0),
    2,
  );
  assert.ok(updates.length, 'the parked row is sent');
});

test('the rows are sized at open for the reach, and a reach past them tells the owner once', async () => {
  const { cells, links, bytes } = world();
  const { port, held, outgrown } = io(bytes);
  held.add('https://cache.test/key/near.json');
  await opened(cells, 100);
  // Only the near cell's two nodes can be held within 100 m: the far one is 5 km off.
  assert.equal(links[0].placements!.capacity, 2);
  cells.frame([0, 0, 0], 100, port, noBudget);
  assert.deepEqual(cells.stats(), { cells: 2, held: 1, waiting: 0, rows: 2 });
  cells.frame([0, 0, 0], everywhere, port, noBudget);
  cells.frame([0, 0, 0], everywhere, port, noBudget);
  assert.equal(outgrown.count, 1, 'asked once for a session opened again');
  // Opened again, the rows are sized for the reach the frames asked, the held rows kept.
  await opened(cells, 100);
  held.add('https://cache.test/key/far.json');
  cells.frame([0, 0, 0], everywhere, port, noBudget);
  assert.deepEqual(cells.stats(), { cells: 2, held: 2, waiting: 0, rows: 4 });
});

test('a world that poses the scene root reads the cells its camera sees there', async () => {
  // The far cell stands at the world's origin once the root is moved back 5 km and shrunk ten
  // times: a camera there asks for it, and not for the near cell, now 500 m away.
  const { cells, root, bytes } = world();
  root.position.set(-500, 0, 0);
  root.scale.set(0.1, 0.1, 0.1);
  const { port, asked } = io(bytes);
  await opened(cells, 100);
  cells.frame([2, 0, 0], 100, port, noBudget);
  assert.deepEqual(asked, ['https://cache.test/key/far.json']);
});

test('rows that hold every cell never ask for a reopen: sized so, or with no owner', async () => {
  for (const owned of [true, false]) {
    const { cells, bytes } = world();
    const { port, held, outgrown } = io(bytes);
    await opened(cells, owned ? 1e4 : 100, owned);
    ['near.json', 'far.json'].forEach((name) => held.add(`https://cache.test/key/${name}`));
    cells.frame([0, 0, 0], 1e7, port, noBudget);
    assert.deepEqual([cells.stats().held, cells.stats().waiting, outgrown.count], [2, 0, 0]);
  }
});

test('a frame says when a cell within reach is left for a later one', async () => {
  const { cells, bytes } = world();
  const { port, held } = io(bytes);
  await opened(cells, everywhere);
  const unread = cells.frame([0, 0, 0], 100, port, noBudget);
  held.add('https://cache.test/key/near.json');
  assert.deepEqual([unread, cells.frame([0, 0, 0], 100, port, noBudget)], [true, false]);
});
