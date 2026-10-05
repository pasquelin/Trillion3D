import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { pose } from '../../host/prepared/nodes.ts';
import { chainWorld } from '../../../../../tests/kit/assert/chainWorld.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { cellUrl, everywhere, io, noBudget, opened, settled, world } from './cells.fixture.ts';
import { sizedWhole } from './cells.fixture.ts';

const row = (rows: PlacementRows, at: number) => [...rows.matrices.subarray(at * 16, at * 16 + 16)];

test('the cells a camera needs are asked nearest first, then placed on rows once read', async () => {
  const { cells, links, bytes } = await sizedWhole(world());
  const { port, asked, updates, held } = io(bytes);
  await settled(cells, [6000, 0, 0], everywhere, port, noBudget);
  assert.deepEqual([...new Set(asked)], [cellUrl('far.json'), cellUrl('near.json')]);
  assert.deepEqual(cells.stats(), { pages: 3, cells: 2, held: 0, waiting: 0, rows: 3 });
  asked.forEach((url) => held.add(url));
  await settled(cells, [6000, 0, 0], everywhere, port, noBudget);
  assert.equal(cells.stats().held, 2);
  for (const link of links) assert.deepEqual([...link.placements!.live.subarray(0, 3)], [1, 1, 1]);
  assert.ok(updates.length >= 2, 'the session is told which rows were written');
});

test('a row holds the world matrix the engine composes for the same node under its parent', async () => {
  const { cells, links, core, bytes, node } = await sizedWhole(world());
  const { port, held } = io(bytes);
  ['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)));
  await settled(cells, [0, 0, 0], everywhere, port, noBudget);
  const child = new Object3D();
  pose(child, node(5000, 0));
  core.add(child);
  const expected = [...chainWorld(child)];
  const rows = links[1].placements!;
  const at = [0, 1, 2].find((index) => row(rows, index)[12] === expected[12])!;
  assert.deepEqual(row(rows, at), expected, 'the same bits as a host node there');
  // The parent moves: the rows under it follow before the next frame.
  core.position.set(0, 20, 0);
  cells.frame([0, 0, 0], everywhere, port, noBudget);
  assert.deepEqual(row(rows, at), [...chainWorld(child)]);
});

test('a cell past its reach gives its rows back, parked, for the next cell to take', async () => {
  const { cells, links, bytes } = await sizedWhole(world());
  const { port, held, updates } = io(bytes);
  ['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)));
  await settled(cells, [0, 0, 0], everywhere, port, noBudget);
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

test('the first frame draws what the first camera reaches: its pages and cells read at open', async () => {
  const { cells, links, bytes } = world(null);
  const urls: string[] = [];
  const read = await opened(cells, (url) => (urls.push(url), bytes(url)), 100);
  // The top index page and the near region page on its way, and the near cell: not the far one.
  assert.deepEqual(cells.stats(), { pages: 2, cells: 1, held: 1, waiting: 0, rows: 2 });
  assert.deepEqual(
    urls.filter((url) => !url.includes('/scene-page-')),
    [cellUrl('near.json')],
  );
  assert.equal(urls.length, 3, 'two pages and one cell');
  assert.equal(
    read,
    urls.reduce((sum, url) => sum + bytes(url).byteLength, 0),
  );
  assert.deepEqual([...links[0].placements!.live], [1, 1]);
});

test('the rows are sized at open for the view, and a reach past them tells the owner once', async () => {
  const { cells, links, bytes } = world(null);
  const { port, held, outgrown } = io(bytes);
  held.add(cellUrl('near.json'));
  await opened(cells, bytes, 100);
  // Only the near cell's two nodes can be held within 100 m: the far one is 5 km off.
  assert.equal(links[0].placements!.capacity, 2);
  cells.frame([0, 0, 0], everywhere, port, noBudget);
  cells.frame([0, 0, 0], everywhere, port, noBudget);
  assert.equal(outgrown.count, 1, 'asked once for a session opened again');
  // Opened again, the rows are sized for the view the frames asked, the held rows kept.
  await opened(cells, bytes, 100);
  held.add(cellUrl('far.json'));
  await settled(cells, [0, 0, 0], everywhere, port, noBudget);
  assert.deepEqual(cells.stats(), { pages: 3, cells: 2, held: 2, waiting: 0, rows: 4 });
});

test('a parent scaled down grows the rows in place, on an engine that takes it, and reopens nothing', async () => {
  // Shrunk a thousand times, the core node both cells hang under brings the one 5 km off to 5 m:
  // both are within 100 m, three nodes on rows sized for the near cell's two. An engine that grows
  // no buffer, or refuses this growth, is left with its rows as they were and asks for a reopen.
  for (const grows of [true, false, undefined]) {
    const { cells, links, core, bytes } = world(0, 0);
    const { port, held, outgrown, updates } = io(bytes);
    const grown: [PlacementRows, PlacementRows][] = [],
      asked: [number, number][] = [];
    if (grows !== undefined)
      port.grow = {
        growsInPlace: (from, capacity) => (asked.push([from.length, capacity]), grows),
        growPlacements: (from, to) => void grown.push([from, to]),
      };
    ['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)));
    await opened(cells, bytes, 100);
    const before = links.map((link) => link.placements!);
    core.scale.set(1e-3, 1e-3, 1e-3);
    await settled(cells, [0, 0, 0], 100, port, noBudget);
    const { held: placed, waiting } = cells.stats();
    assert.deepEqual([placed, waiting, outgrown.count], grows ? [2, 0, 0] : [1, 1, 1]);
    if (grows !== undefined) assert.deepEqual(asked, [[2, 4]], 'both buffers asked at once');
    if (!grows) {
      assert.deepEqual(grown, [], 'no buffer replaced: the session reads the ones it holds');
      assert.ok(links.every((link, at) => link.placements === before[at]));
      // The session opened again sizes the rows for the view and places the far cell.
      await opened(cells, bytes, 100);
      assert.deepEqual([cells.stats().held, cells.stats().rows], [2, 4]);
      continue;
    }
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

test('rows that hold every cell never ask for a reopen: sized so, or with no owner', async () => {
  for (const owned of [true, false]) {
    const { cells, bytes } = world();
    const { port, held, outgrown } = io(bytes);
    await opened(cells, bytes, owned ? 1e4 : 100, owned);
    ['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)));
    await settled(cells, [0, 0, 0], 1e7, port, noBudget);
    assert.deepEqual([cells.stats().held, cells.stats().waiting, outgrown.count], [2, 0, 0]);
  }
});

test('a world that poses the scene root reads the cells its camera sees there', async () => {
  // The far cell stands at the world's origin once the root is moved back 5 km and shrunk ten
  // times: a camera there asks for it, and not for the near cell, now 500 m away.
  const { cells, root, bytes } = await sizedWhole(world());
  root.position.set(-500, 0, 0);
  root.scale.set(0.1, 0.1, 0.1);
  const { port, asked } = io(bytes);
  await settled(cells, [2, 0, 0], 100, port, noBudget);
  assert.deepEqual([...new Set(asked)], [cellUrl('far.json')]);
});
