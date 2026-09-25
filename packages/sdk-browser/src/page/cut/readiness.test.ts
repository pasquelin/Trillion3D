// The residency the cut rule reads (#486): whole groups, closed upward, kept by difference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { createCutReadiness } from './readiness.ts';

const dag = ruleDag(64),
  s = dag.structure,
  pages = dag.pages.length,
  nodes = dag.culling.nodes.length / dag.culling.stride;

/** The definition, written the slow way: a group is ready when its members are resident and the
 *  group of each of its outputs is — an output nothing replaces standing for itself. */
function reference(resident: Uint8Array) {
  const memo = new Map<number, boolean>();
  const group = (g: number): boolean => {
    if (!memo.has(g)) {
      let ready = true;
      for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++)
        ready &&= resident[s.children[i]] === 1;
      for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
        const o = s.outputs[i];
        ready &&= s.owners[o] < 0 ? resident[o] === 1 : group(s.owners[o]);
      }
      memo.set(g, ready);
    }
    return memo.get(g)!;
  };
  const ready = Uint8Array.from({ length: pages }, (_, p) =>
    (s.owners[p] < 0 ? resident[p] === 1 : group(s.owners[p])) ? 1 : 0,
  );
  const childReady = Uint8Array.from({ length: pages }, (_, p) =>
    s.sources[p] < 0 || group(s.sources[p]) ? 1 : 0,
  );
  const open = new Int32Array(nodes);
  for (let p = 0; p < pages; p++)
    for (let n = dag.culling.links.leafOfPage[p]; !childReady[p] && n >= 0;) {
      open[n]++;
      n = dag.culling.links.parents[n];
    }
  return { ready, childReady, open };
}

function random(seed: number) {
  let v = seed >>> 0;
  return () => (v = (Math.imul(v, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

test('kept by difference, readiness is the definition after every change', () => {
  const r = createCutReadiness(s, dag.culling.links, pages, nodes);
  const resident = new Uint8Array(pages),
    next = random(7);
  for (let step = 0; step < 200; step++) {
    // A handful of pages arrive or leave, in any order: parents after children included.
    for (let k = 0; k < 1 + Math.floor(next() * 6); k++) {
      const p = Math.floor(next() * pages);
      resident[p] ^= 1;
      r.set(p, resident[p] === 1);
    }
    r.settle();
    const want = reference(resident);
    assert.deepEqual(r.ready, want.ready, `step ${step}: ready`);
    assert.deepEqual(r.childReady, want.childReady, `step ${step}: childReady`);
    assert.deepEqual(r.open, want.open, `step ${step}: open counts`);
  }
});

test('a missing page leaves its group, and every group below it, not ready', () => {
  const r = createCutReadiness(s, dag.culling.links, pages, nodes);
  for (let p = 0; p < pages; p++) r.set(p, true);
  r.settle();
  assert.ok(r.ready.every((v) => v === 1) && r.childReady.every((v) => v === 1));
  assert.ok(
    r.open.every((v) => v === 0),
    'nothing is open once everything is resident',
  );
  // A cluster just under the roots leaves: its group-mates stop being drawable, and so does every
  // cluster whose group closes over it.
  const missing = dag.pages.findIndex(
    (p) => p.group !== null && s.owners[s.outputs[s.outputOffsets[p.group]]] < 0,
  );
  r.set(missing, false);
  const touched: number[] = [];
  r.settle((page) => touched.push(page));
  const g = dag.pages[missing].group!;
  for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++)
    assert.equal(r.ready[s.children[i]], 0, 'the whole group is withheld');
  assert.ok(touched.length > s.childOffsets[g + 1] - s.childOffsets[g], 'groups below follow');
  const resident = new Uint8Array(pages).fill(1);
  resident[missing] = 0;
  assert.deepEqual(r.ready, reference(resident).ready);
});

test('without group links, each cluster stands for itself', () => {
  const r = createCutReadiness(undefined, undefined, 3, 1);
  r.set(1, true);
  r.settle();
  assert.deepEqual([...r.ready], [0, 1, 0]);
  assert.deepEqual([...r.childReady], [1, 1, 1]);
});
