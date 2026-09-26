import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { pose } from '../../host/prepared/nodes.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { PartitionCells } from './cells.ts';
import { world } from './cells.fixture.ts';

type PartitionIo = Parameters<PartitionCells['frame']>[2];

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
const noBudget = { admits: () => true, spend() {} };
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
  const child = new Object3D();
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
  const { cells, links, bytes } = world(null);
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

test('a parent scaled down grows the rows in place, on an engine that can, and reopens nothing', async () => {
  // Shrunk a thousand times, the core node both cells hang under brings the one 5 km off to 5 m:
  // both are within 100 m, three nodes on rows sized for the near cell's two.
  for (const grows of [true, false]) {
    const { cells, links, core, bytes } = world(0, 0);
    const { port, held, outgrown, updates } = io(bytes);
    const grown: [PlacementRows, PlacementRows][] = [];
    if (grows) port.grow = (from, to) => void grown.push([from, to]);
    ['near.json', 'far.json'].forEach((name) => held.add(`https://cache.test/key/${name}`));
    await opened(cells, 100);
    const before = links.map((link) => link.placements!);
    core.scale.set(1e-3, 1e-3, 1e-3);
    cells.frame([0, 0, 0], 100, port, noBudget);
    cells.frame([0, 0, 0], 100, port, noBudget);
    const { held: placed, waiting } = cells.stats();
    assert.deepEqual([placed, waiting, outgrown.count], grows ? [2, 0, 0] : [1, 1, 1]);
    if (!grows) continue; // it asks its owner to reopen
    const after = links.map((link) => link.placements!);
    assert.deepEqual(
      grown,
      [0, 1].map((at) => [before[at], after[at]]),
    );
    // The engine is told of the grown buffers only: no row of the old ones is read again.
    assert.ok(updates.every(([rows]) => after.includes(rows)));
    assert.ok(after.every((rows) => rows.live.reduce((a, b) => a + b, 0) === 3));
  }
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
