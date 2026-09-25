// One cut rule per cluster (#486): on a synthetic DAG whose pages leave at random, every backend
// covers every leaf exactly once, by the cluster it wants or by that cluster's nearest resident
// ancestor — never coarser, and never a whole primitive coarsened for one missing page. The kernel
// model runs twice: with the TypeScript rule, and with the kernel's own WGSL text run in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverFault, ruleDag, type RuleDag } from './cutRule.fixture.ts';
import {
  floorPrunedPages,
  oracleBackend,
  wgslBackend,
  type CutBackend,
} from './cutRuleBackends.fixture.ts';
import { CUT_RULE_WGSL } from './rule.ts';
import { createCutReadiness } from './readiness.ts';

const THRESHOLD = 0.1;
const dag = ruleDag(256);
const backends: Record<string, (dag: RuleDag, threshold: number) => CutBackend> = {
  'GPU kernel model': oracleBackend,
  'GPU kernel WGSL rule': wgslBackend,
};

/** A reproducible sequence in [0, 1). */
function random(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

const isRoot = (page: number) => dag.pages[page].group === null;

/** The cluster covering unit `u` one level above `page`: the output of its group that holds `u`. */
function parentAt(page: number, u: number) {
  const g = dag.pages[page].group!,
    s = dag.structure;
  for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
    const [a, b] = dag.pages[s.outputs[i]].units;
    if (a <= u && u < b) return s.outputs[i];
  }
  throw new Error(`no parent of ${page} covers ${u}`);
}

/** For each leaf unit, the cluster the rule must draw there: the wanted one, or its nearest
 *  ancestor the cut rule's residency holds. */
function expectedAt(wanted: number[], ready: Uint8Array) {
  const at = new Int32Array(dag.leaves);
  for (const w of wanted) {
    const [a, b] = dag.pages[w].units;
    for (let u = a; u < b; u++) {
      let c = w;
      while (!ready[c]) c = parentAt(c, u);
      at[u] = c;
    }
  }
  return at;
}

function readinessOf(resident: Uint8Array) {
  const r = createCutReadiness(dag.structure, dag.culling.links, dag.pages.length, 1);
  resident.forEach((v, page) => r.set(page, v === 1));
  r.settle();
  return r.ready;
}

/** The three invariants, on one frame. */
function check(name: string, cut: { drawn: number[]; wanted: number[] }, resident: Uint8Array) {
  assert.equal(coverFault(dag, cut.drawn), -1, `${name}: a leaf is not covered exactly once`);
  const expected = expectedAt(cut.wanted, readinessOf(resident));
  for (const page of cut.drawn) {
    const [a, b] = dag.pages[page].units;
    for (let u = a; u < b; u++)
      assert.equal(page, expected[u], `${name}: unit ${u} drawn by ${page}, not ${expected[u]}`);
  }
}

const full = () => new Uint8Array(dag.pages.length).fill(1);

/** Forty frames, pages removed at random, the three invariants checked on each. */
function randomFrames(cut: CutBackend) {
  const next = random(486);
  for (let frame = 0; frame < 40; frame++) {
    const keep = 0.3 + 0.6 * next();
    const resident = full().map((_, p) => (isRoot(p) || next() < keep ? 1 : 0));
    check(`frame ${frame}`, cut(resident), resident);
  }
}

test('the WGSL run is the kernel text: a rule that forgets the missing finer group opens holes', () => {
  const forgets = CUT_RULE_WGSL.replace(
    '(ownPixels<=threshold||!childResident)',
    'ownPixels<=threshold',
  );
  assert.notEqual(forgets, CUT_RULE_WGSL);
  assert.throws(
    () => randomFrames(wgslBackend(dag, THRESHOLD, forgets)),
    /not covered exactly once/,
  );
});

for (const [name, backend] of Object.entries(backends)) {
  const cut = backend(dag, THRESHOLD);

  test(`${name}: at full residency the cut draws exactly what it wants, at every threshold`, () => {
    // No image loss: with every page resident the rule is the plain band test, the cut `develop`
    // draws, and top-down pruning drops no more than it did.
    for (const threshold of [0.05, THRESHOLD, 0.3, 1]) {
      const { drawn, wanted } = backend(dag, threshold)(full());
      const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);
      assert.deepEqual(sorted(drawn), sorted(wanted), `at ${threshold} px`);
      assert.equal(coverFault(dag, drawn), -1);
    }
    assert.ok(new Set(cut(full()).wanted.map((p) => dag.pages[p].level)).size >= 3);
  });

  test(`${name}: pages removed at random, each leaf drawn once by its nearest resident ancestor`, () => {
    randomFrames(cut);
  });

  test(`${name}: one missing page coarsens its neighbourhood by one level, never the primitive`, () => {
    const { wanted } = cut(full());
    const s = dag.structure,
      before = new Set(wanted),
      spanOf = (pages: number[]) =>
        pages.reduce((n, p) => n + dag.pages[p].units[1] - dag.pages[p].units[0], 0);
    for (const missing of wanted.filter((p) => !isRoot(p))) {
      const resident = full();
      resident[missing] = 0;
      const frame = cut(resident);
      check(`without ${missing}`, frame, resident);
      // Its group's outputs replace it and its siblings; the groups below them that straddle a
      // sibling follow them, since a group is drawn whole (./readiness.ts). One level up at most.
      const g = dag.pages[missing].group!,
        outputs = [...s.outputs.subarray(s.outputOffsets[g], s.outputOffsets[g + 1])],
        added = frame.drawn.filter((p) => !before.has(p));
      for (const output of outputs) assert.ok(added.includes(output), `output ${output} not drawn`);
      for (const p of added) assert.ok(dag.pages[p].level <= dag.pages[missing].level + 1);
      assert.ok(spanOf(added) <= 2 * spanOf(outputs), `${spanOf(added)} units coarsened`);
    }
  });

  test(`${name}: an ancestor top-down pruning drops is drawn when its finer group leaves`, () => {
    // Crossing, holding, recovery (#3): a missing page whose replacement lies in a subtree the
    // descent drops on its floor at full residency. Nothing carries from frame to frame: the open
    // count of that subtree alone brings the replacement back into the cut.
    const pruned = new Set(floorPrunedPages(dag, THRESHOLD)),
      { wanted } = cut(full()),
      s = dag.structure;
    const crossing = wanted.filter((p) => {
      const g = dag.pages[p].group;
      return (
        g !== null &&
        [...s.outputs.subarray(s.outputOffsets[g], s.outputOffsets[g + 1])].some((o) =>
          pruned.has(o),
        )
      );
    });
    assert.ok(
      crossing.length > 0,
      'no replacement lies in a pruned subtree: the proof covers nothing',
    );
    for (const missing of crossing) {
      const resident = full();
      resident[missing] = 0;
      check(`crossing without ${missing}`, cut(resident), resident);
      check(`holding without ${missing}`, cut(resident), resident);
      const back = cut(full());
      assert.deepEqual(
        back.drawn.sort((a, b) => a - b),
        [...wanted].sort((a, b) => a - b),
      );
    }
  });
}
