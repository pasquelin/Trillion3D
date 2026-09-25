// The cache is asked for whole groups, closed upward (#486): what the cut rule needs to draw what
// the cut wants, and nothing a cut that leaves still holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { createGroupClosure } from './groupClosure.ts';
import type { PageRec } from '../selection/selection.ts';
import type { ClusterRoot } from '../selection/types.ts';

const dag = ruleDag(64),
  s = dag.structure;
/** Two placements of the DAG, packed one after the other as the layout packs them. */
const roots = [0, 1].map((placement) => ({
  world: dag.world,
  structure: s,
  pages: dag.pages.map((page, p) => ({
    ...page,
    placementIndex: placement,
    packedIndex: placement * dag.pages.length + p,
  })),
})) as unknown as ClusterRoot<PageRec>[];
const packed = roots.flatMap((root) => root.pages);
const n = dag.pages.length;

/** The pages page `p` of placement 0 closes over, by the definition. */
function expected(p: number) {
  const out = new Set<number>();
  const group = (g: number) => {
    for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++) out.add(s.children[i]);
    for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
      const o = s.outputs[i];
      if (s.owners[o] < 0) out.add(o);
      else group(s.owners[o]);
    }
  };
  if (s.owners[p] < 0) out.add(p);
  else group(s.owners[p]);
  return out;
}

const cutDelta = (entered: number[], exited: number[] = []) => ({
  entered: Int32Array.from(entered),
  exited: Int32Array.from(exited),
  enteredCount: entered.length,
  exitedCount: exited.length,
  has: () => false,
});

test('a leaf brings its group and every group above it, in its own placement only', () => {
  const closure = createGroupClosure(roots, packed);
  const leaf = dag.pages.findIndex((p) => p.level === 0);
  closure.apply(cutDelta([leaf]));
  const held = new Set(closure.delta.entered.subarray(0, closure.delta.enteredCount));
  assert.deepEqual(held, expected(leaf));
  assert.ok(
    [...held].every((id) => id < n),
    'the other placement holds nothing',
  );
  assert.ok(
    [...held].some((id) => dag.pages[id].group === null),
    'up to the roots',
  );
  const visited = new Set<number>();
  closure.closeOver([leaf], (id) => visited.add(id));
  assert.deepEqual(visited, expected(leaf), 'a rebuilt list closes over the same pages');
});

test('pages shared by two cut pages stay held until the last one leaves', () => {
  const closure = createGroupClosure(roots, packed);
  const [a, b] = dag.pages.map((_, p) => p).filter((p) => dag.pages[p].level === 0);
  closure.apply(cutDelta([a, b]));
  const both = closure.delta.enteredCount;
  closure.apply(cutDelta([], [a]));
  const left = new Set(closure.delta.exited.subarray(0, closure.delta.exitedCount));
  const still = expected(b);
  assert.ok(
    [...left].every((id) => !still.has(id)),
    'nothing b still needs leaves',
  );
  assert.ok([...still].every((id) => closure.delta.has(id)));
  closure.apply(cutDelta([], [b]));
  assert.equal(left.size + closure.delta.exitedCount, both, 'the last exit releases the rest');
  assert.ok(packed.every((_, id) => !closure.delta.has(id)));
});

test('a page leaving as its group-mate joins lets nothing go in between', () => {
  const closure = createGroupClosure(roots, packed);
  const g = dag.pages[dag.pages.findIndex((p) => p.level === 0)].group!;
  const [a, b] = [...s.children.subarray(s.childOffsets[g], s.childOffsets[g] + 2)];
  closure.apply(cutDelta([a]));
  closure.apply(cutDelta([b], [a]));
  assert.equal(closure.delta.enteredCount + closure.delta.exitedCount, 0, 'the same closure');
});

test('the second placement closes over its own pages, at its packed ids', () => {
  const closure = createGroupClosure(roots, packed);
  const leaf = dag.pages.findIndex((p) => p.level === 0);
  closure.apply(cutDelta([n + leaf]));
  const held = [...closure.delta.entered.subarray(0, closure.delta.enteredCount)];
  assert.deepEqual(new Set(held.map((id) => id - n)), expected(leaf));
  const visited: PageRec[] = [];
  closure.closeOverRecords([roots[1].pages[leaf]], (_, rec) => visited.push(rec));
  assert.deepEqual(
    new Set(visited),
    new Set([...expected(leaf)].map((p) => roots[1].pages[p])),
    'records close over the same pages, without a catalogue',
  );
});

test('the closure holds what the cut closes over, and nothing once the cut has left', () => {
  const closure = createGroupClosure(roots, packed);
  assert.equal(closure.hostBytes, 64, 'two empty difference lists');
  const leaves = dag.pages.map((_, p) => p).filter((p) => dag.pages[p].level === 0);
  closure.apply(cutDelta(leaves));
  const held = closure.hostBytes;
  closure.apply(cutDelta([], leaves));
  const left = closure.hostBytes;
  assert.ok(left < held, 'the counts leave with the cut; only scratch sized by it stays');
  closure.apply(cutDelta(leaves));
  closure.apply(cutDelta([], leaves));
  assert.equal(closure.hostBytes, left, 'the same cut again grows nothing');
});

test('a walk whose visitor is full stops before the next page', () => {
  const closure = createGroupClosure(roots, packed);
  const [a, b] = dag.pages.map((_, p) => p).filter((p) => dag.pages[p].level === 0);
  const visited = new Set<number>();
  closure.closeOver(
    [a, b + n],
    (id) => visited.add(id),
    () => visited.size > 0,
  );
  assert.deepEqual(visited, expected(a), 'the first page closes over its groups whole');
  closure.closeOver([b + n], (id) => visited.add(id));
  assert.ok(visited.size > expected(a).size, 'the next walk starts afresh');
});
