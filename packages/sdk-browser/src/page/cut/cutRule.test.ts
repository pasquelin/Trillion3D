// One cut rule per cluster (#486): on a synthetic DAG whose pages leave at random, every backend
// covers every leaf exactly once, by the cluster it wants or by that cluster's nearest resident
// ancestor — never coarser, and never a whole primitive coarsened for one missing page. The kernel
// model runs twice: with the TypeScript rule, and with the kernel's own `dagMask` call site run in
// Node on the residency bits its host uploads. The CPU cut and the WebGL2 image's cut run the same
// rule on the same DAG (#483 rules 1, 2 and 8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverFault, ruleDag, type RuleDag } from './cutRule.fixture.ts';
import {
  cpuBackend,
  floorPrunedPages,
  oracleBackend,
  webgl2Backend,
  wgslBackend,
  type CutBackend,
} from './cutRuleBackends.fixture.ts';
import { DEVELOP_FULL_CUT, ruleChecks } from './cutRuleChecks.fixture.ts';

const THRESHOLD = 0.1;
const dag = ruleDag(256);
const backends: Record<string, (dag: RuleDag, threshold: number) => CutBackend> = {
  'GPU kernel model': oracleBackend,
  'GPU kernel WGSL call site': wgslBackend,
  'CPU cut': cpuBackend,
  'WebGL2 cut': webgl2Backend,
};

const { isRoot, check, full, randomFrames, digest } = ruleChecks(dag);

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
      assert.equal(digest(drawn), DEVELOP_FULL_CUT[threshold], `at ${threshold} px: not develop's`);
    }
    assert.ok(new Set(cut(full()).wanted.map((p) => dag.pages[p].level)).size >= 3);
  });

  test(`${name}: pages removed at random, each leaf drawn once by its nearest resident ancestor`, () => {
    randomFrames(cut);
  });

  test(`${name}: once every page is back, the cut is the full-residency one again`, () => {
    // No image loss (#483 rule 2): the coarsening is temporary, whatever state the backend kept.
    const before = digest(cut(full()).drawn);
    randomFrames(cut);
    assert.equal(digest(cut(full()).drawn), before);
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
