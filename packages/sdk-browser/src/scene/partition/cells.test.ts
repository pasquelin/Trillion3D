import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { pose } from '../../host/prepared/nodes.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { cellUrl, everywhere, io, noBudget, settled, world } from './cells.fixture.ts';

const row = (rows: PlacementRows, at: number) => [...rows.matrices.subarray(at * 16, at * 16 + 16)];

test('the cells a camera needs are asked nearest first, then placed on rows once read', async () => {
  const { cells, links, bytes } = world();
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
  const { cells, links, core, bytes, node } = world();
  const { port, held } = io(bytes);
  ['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)));
  await settled(cells, [0, 0, 0], everywhere, port, noBudget);
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

test('the rows are sized at open from the root, for every node, before anything is read', () => {
  const { cells, links } = world();
  assert.deepEqual(cells.stats(), { pages: 0, cells: 0, held: 0, waiting: 0, rows: 3 });
  assert.ok(links.every((link) => link.placements!.capacity === 3));
});

test('a parent scaled down brings its cells together on the rows sized at open: nothing grows', async () => {
  // Shrunk a thousand times, the core node both cells hang under brings the one 5 km off to 5 m:
  // both are within 100 m, three nodes on the three rows the root counted.
  const { cells, links, core, bytes } = world(0, 0);
  const { port, held } = io(bytes);
  ['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)));
  const before = links.map((link) => link.placements!);
  core.scale.set(1e-3, 1e-3, 1e-3);
  await settled(cells, [0, 0, 0], 100, port, noBudget);
  assert.deepEqual([cells.stats().held, cells.stats().waiting], [2, 0]);
  assert.ok(
    links.every((link, at) => link.placements === before[at]),
    'the same buffers',
  );
  assert.ok(before.every((rows) => rows.live.reduce((a, b) => a + b, 0) === 3));
});

test('a world that poses the scene root reads the cells its camera sees there', async () => {
  // The far cell stands at the world's origin once the root is moved back 5 km and shrunk ten
  // times: a camera there asks for it, and not for the near cell, now 500 m away.
  const { cells, root, bytes } = world();
  root.position.set(-500, 0, 0);
  root.scale.set(0.1, 0.1, 0.1);
  const { port, asked } = io(bytes);
  await settled(cells, [2, 0, 0], 100, port, noBudget);
  assert.deepEqual([...new Set(asked)], [cellUrl('far.json')]);
});
