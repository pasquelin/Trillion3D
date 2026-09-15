import test from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import type { ClusterRoot } from './pageSelectionTypes.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import { createTransparentTable, TRANSPARENT_GROUP } from './webgpuTransparentTable.ts';
import { evaluateTransparentCompaction } from './webgpuTransparentCompactCpu.ts';
import { CULL_STRIDE } from './gpuDagTypes.ts';

const mesh = (name: string) => ({ name }) as unknown as THREE.Mesh;
const rec = (sourceMesh: THREE.Mesh, id: number, sourceOrder: number, transparent = true) =>
  ({ id, sourceOrder, transparent, sourceMesh, triangles: 1 }) as unknown as PageRec;

/** One primitive: its pages, and optionally the culling tree the cut walks them with. */
function root(pages: PageRec[], leaves?: number[][]): ClusterRoot<PageRec> {
  if (!leaves) return { pages } as unknown as ClusterRoot<PageRec>;
  // A root node over `leaves.length` leaves, each holding a contiguous run of pages.
  const nodes = new Float64Array((leaves.length + 1) * CULL_STRIDE);
  nodes[12] = leaves.length;
  nodes[11] = 1;
  let first = 0;
  for (let leaf = 0; leaf < leaves.length; leaf++) {
    const base = (leaf + 1) * CULL_STRIDE;
    nodes[base + 12] = 0;
    nodes[base + 13] = first;
    nodes[base + 14] = leaves[leaf].length;
    first += leaves[leaf].length;
  }
  return { pages, culling: { nodes, stride: CULL_STRIDE } } as unknown as ClusterRoot<PageRec>;
}
const item = (sourceMesh: THREE.Mesh | undefined, paged: boolean) =>
  ({ sourceMesh, paged }) as unknown as BlendGpuItem;

/** A reproducible pseudo-random stream: the sweep below has to be the same on every run. */
function stream(seed: number) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

/** The order the culling walk emits a primitive's pages in — the one the CPU cut published. */
function walk(source: ClusterRoot<PageRec>) {
  const order: number[] = [];
  const culling = source.culling;
  if (!culling) return source.pages.map((_, index) => index);
  const stack = [0];
  while (stack.length) {
    const base = stack.pop()! * culling.stride,
      children = culling.nodes[base + 12];
    if (children > 0) {
      for (let child = 0; child < children; child++) stack.push(culling.nodes[base + 11] + child);
      continue;
    }
    for (let i = 0; i < culling.nodes[base + 14]; i++) order.push(culling.nodes[base + 13] + i);
  }
  return order;
}

/** What the CPU path did every image: keep this primitive's records in the order the cut emitted
 *  them, then sort them — stably — by the rank the source recorded. */
function cpuOrder(source: ClusterRoot<PageRec>, base: number, keep: ReadonlySet<number>) {
  return walk(source)
    .filter((index) => keep.has(base + index))
    .map((index, at) => ({ index, at }))
    .sort(
      (a, b) =>
        (source.pages[a.index].sourceOrder ?? source.pages[a.index].id) -
          (source.pages[b.index].sourceOrder ?? source.pages[b.index].id) || a.at - b.at,
    )
    .map((entry) => base + entry.index);
}

test('the table is the source draw order, the culling walk separating equal ranks', () => {
  const [a, b] = [mesh('a'), mesh('b')];
  // Two leaves; the walk pops the last-pushed first, so pages 2 and 3 are visited before 0 and 1.
  const ra = root(
    [rec(a, 0, 7), rec(a, 1, 7), rec(a, 2, 7), rec(a, 3, 4)],
    [
      [0, 1],
      [2, 3],
    ],
  );
  const rb = root([rec(b, 4, 2), rec(b, 5, 1)]);
  const packed = [...ra.pages, ...rb.pages];
  const table = createTransparentTable([ra, rb], packed, [item(a, true), item(b, true)]);
  assert.deepEqual([...table.itemRanges], [0, 4, TRANSPARENT_GROUP, 2]);
  // Rank 4 first, then the three that share rank 7 in the order the walk reaches them.
  assert.deepEqual([...table.entries.subarray(0, 4)], [3, 2, 0, 1]);
  assert.deepEqual([...table.entries.subarray(TRANSPARENT_GROUP, TRANSPARENT_GROUP + 2)], [5, 4]);
  assert.equal(table.entryOfPage[3], 0);
  assert.equal(table.maxVertexWords, 3);
});

test('the compaction keeps the table order and nothing else, on every subset', () => {
  const next = stream(20260915);
  for (let trial = 0; trial < 150; trial++) {
    const roots: Array<ClusterRoot<PageRec>> = [];
    const bases: number[] = [];
    const meshes: THREE.Mesh[] = [];
    const packed: PageRec[] = [];
    for (let m = 0; m < 3; m++) {
      const source = mesh(`m${m}`);
      const count = 1 + Math.floor(next() * 40);
      const pages = Array.from({ length: count }, (_, index) =>
        rec(source, packed.length + index, Math.floor(next() * 8)),
      );
      const leaves: number[][] = [];
      for (let at = 0; at < count;) {
        const run = 1 + Math.floor(next() * 6);
        leaves.push(Array.from({ length: Math.min(run, count - at) }, (_, k) => at + k));
        at += run;
      }
      const built = root(pages, next() < 0.75 ? leaves : undefined);
      bases.push(packed.length);
      packed.push(...pages);
      roots.push(built);
      meshes.push(source);
    }
    const table = createTransparentTable(
      roots,
      packed,
      meshes.map((source) => item(source, true)),
    );
    const keep = new Set<number>();
    for (let page = 0; page < packed.length; page++) if (next() < 0.5) keep.add(page);
    const result = evaluateTransparentCompaction({
      entries: table.entries,
      itemRanges: table.itemRanges,
      entryCount: table.length,
      itemCount: table.pagedItems.length,
      vertexCount: table.maxVertexWords,
      selected: (cluster) => keep.has(cluster),
    });
    for (let index = 0; index < roots.length; index++) {
      const start = table.itemRanges[index * 2],
        drawn = result.indirect[index * 4 + 1];
      const got = [...result.instances.subarray(start, start + drawn)].map(
        (entry) => table.pageOfEntry[entry],
      );
      assert.deepEqual(got, cpuOrder(roots[index], bases[index], keep), `essai ${trial}/${index}`);
      assert.equal(result.indirect[index * 4], table.maxVertexWords);
    }
  }
});
