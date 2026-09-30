import test from 'node:test';
import assert from 'node:assert/strict';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';
import { postPackedBases } from '../../page/selection/placements.ts';
import { createTransparentTable } from '../transparent/table.ts';
import { writeCpuTransparentInstances } from './selection.ts';
import { createWebgpuBlendState, type BlendGpuItem } from './state.ts';

type Table = ReturnType<typeof createTransparentTable>;

/**
 * What `develop` wrote before the table named each entry's item: the item looked up by the
 * placement of the record, the last paged item of that placement, as its map kept it.
 */
function developInstances(
  table: Table,
  drawn: PageRec[],
  entryOf: (rec: PageRec) => number,
  worldOf: (rec: PageRec) => unknown,
) {
  const byPlacement = new Map<unknown, BlendGpuItem>();
  for (const item of table.pagedItems) byPlacement.set(item.matrix, item);
  const instances = new Uint32Array(table.capacity),
    counts = new Uint32Array(table.pagedItems.length);
  let highest = 0;
  for (const rec of drawn) {
    const world = worldOf(rec),
      item = rec.transparent ? byPlacement.get(world) : undefined;
    const entry = item ? entryOf(rec) : -1;
    if (entry < 0) continue;
    const base = table.itemRanges[item!.pagedIndex! * 2];
    instances[base + counts[item!.pagedIndex!]++] = entry;
    highest = Math.max(highest, base + counts[item!.pagedIndex!]);
  }
  for (let index = 0; index < table.pagedItems.length; index++) {
    const base = table.itemRanges[index * 2];
    instances.subarray(base, base + counts[index]).sort();
  }
  return { instances: Array.from(instances.subarray(0, highest)), counts: Array.from(counts) };
}

/**
 * A random scene: placements of one or two primitives (a second root of a placement shadows the
 * first in the table), paged and unpaged items, placements with a paged item several times, roots
 * no item reads, opaque roots, and pages outside the catalogue.
 */
function scene(seed: number) {
  const next = random(seed),
    pick = (n: number) => Math.floor(next() * n);
  const roots: ClusterRoot<PageRec>[] = [],
    items: BlendGpuItem[] = [],
    packedPages: PageRec[] = [];
  const placements = 1 + pick(8);
  for (let p = 0; p < placements; p++) {
    const matrix = { placement: p },
      transparent = next() < 0.85;
    for (let r = 0, primitives = 1 + pick(2); r < primitives; r++) {
      const pages = Array.from(
        { length: pick(90) },
        // A transparent root may hold an opaque page past its first: the table files it, the cut
        // does not draw it as a transparent.
        (_, i) =>
          ({
            id: i,
            sourceOrder: pick(20),
            transparent: transparent && (i === 0 || next() < 0.9),
            triangles: 1,
          }) as unknown as PageRec,
      );
      roots.push({ pages, world: matrix } as unknown as ClusterRoot<PageRec>);
      packedPages.push(...pages);
    }
    for (let i = 0, copies = pick(3); i < copies; i++)
      items.push({ matrix, paged: next() < 0.8 } as unknown as BlendGpuItem);
  }
  const table = createTransparentTable(roots, packedPages, items);
  table.pagedItems.forEach((item, index) => (item.pagedIndex = index));
  const pageOf = new Map(packedPages.map((rec, index) => [rec, index])),
    { rootOfPacked } = postPackedBases(roots);
  const worldOf = (rec: PageRec) => {
    const packed = pageOf.get(rec);
    return packed === undefined ? undefined : roots[rootOfPacked[packed]]?.world;
  };
  const entryOf = (rec: PageRec) => {
    const page = pageOf.get(rec);
    return page === undefined ? -1 : table.entryOfPage[page];
  };
  // A cut in any order, with repeats and records the catalogue does not hold.
  const drawn = packedPages.filter(() => next() < 0.6);
  for (let i = drawn.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [drawn[i], drawn[j]] = [drawn[j], drawn[i]];
  }
  if (drawn.length) drawn.push(drawn[pick(drawn.length)]);
  drawn.push({ ...packedPages[0], transparent: true } as PageRec);
  return { table, drawn: next() < 0.05 ? [] : drawn, entryOf, roots, pageOf, worldOf };
}

test('CPU transparent instances are word for word those of the lookup by placement', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const { table, drawn, entryOf, pageOf, worldOf } = scene(seed);
    const blendState = createWebgpuBlendState();
    blendState.table = table;
    const drawnPacked = drawn.map((rec) => pageOf.get(rec) ?? -1);
    writeCpuTransparentInstances(blendState, drawn, drawnPacked, (packed) =>
      packed < 0 ? -1 : table.entryOfPage[packed],
    );
    const expected = developInstances(table, drawn, entryOf, worldOf);
    assert.deepEqual(
      {
        instances: Array.from(blendState.cpuInstances.subarray(0, blendState.cpuInstanceCount)),
        counts: Array.from(blendState.cpuItemCounts.subarray(0, expected.counts.length)),
      },
      expected,
      `seed ${seed}`,
    );
  }
});

test('the table names the item of every entry it holds, and none for padding', () => {
  const { table } = scene(7);
  for (let index = 0; index < table.pagedItems.length; index++) {
    const base = table.itemRanges[index * 2],
      count = table.itemRanges[index * 2 + 1];
    for (let entry = base; entry < base + count; entry++)
      assert.equal(table.itemOfEntry[entry], index);
  }
  for (let entry = 0; entry < table.capacity; entry++)
    if (table.pageOfEntry[entry] < 0) assert.equal(table.itemOfEntry[entry], -1);
});
