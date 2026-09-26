// The cut rule's readiness follows the pool's residency feed (#483 rules 6 and 7, #486): a still
// view reads no page's residency, a change reads the pages that moved and no other, and a placement
// that leaves the view lets its readiness go, the running total exact. Counted, never timed: every
// residency answer a cut asks for, on the CPU cut and the WebGL2 image's cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { AWAY, placements } from './cutRuleBackends.fixture.ts';
import { cpuBackend, webgl2Backend } from './cutRuleHosts.fixture.ts';
import { random } from './cutRuleChecks.fixture.ts';
import { createWebgpuPagesLayout } from '../../webgpu/pages/prepare/layout.ts';
import type { WebgpuPagesSetup } from '../../webgpu/pages/prepare/setup.ts';

const THRESHOLD = 0.1;
const dag = ruleDag(64),
  n = dag.pages.length;

const backends = {
  'CPU cut': cpuBackend,
  'WebGL2 cut': webgl2Backend,
};
/** `name`'s backend over `roots`, by default two placements of the DAG, both in view. */
const mount = <K extends keyof typeof backends>(name: K, roots = placements(dag, 2)) =>
  backends[name](dag, THRESHOLD, roots) as ReturnType<(typeof backends)[K]>;
const sorted = (ids: number[]) => ids.sort((a, b) => a - b);

/** Per-page residency of both placements: every root, and a random share of the rest. */
function residency(next: () => number) {
  return Uint8Array.from({ length: 2 * n }, (_, at) =>
    dag.pages[at % n].group === null || next() < 0.6 ? 1 : 0,
  );
}

for (const name of Object.keys(backends) as (keyof typeof backends)[]) {
  test(`${name}: a still view reads no page of readiness`, () => {
    const cut = mount(name),
      resident = residency(random(1));
    cut(resident);
    const entered = cut.reads();
    assert.ok(entered >= 2 * n, 'the placements entering the view are read whole');
    for (let frame = 0; frame < 4; frame++) cut(resident);
    assert.equal(cut.reads(), entered);
  });

  test(`${name}: a residency change reads the pages that moved and no other`, () => {
    const next = random(2),
      cut = mount(name),
      resident = residency(next);
    cut(resident);
    for (let frame = 0; frame < 8; frame++) {
      const before = cut.reads(),
        was = resident.slice();
      for (let i = 0, flips = 1 + next() * 6; i < flips; i++) {
        const at = Math.floor(next() * resident.length);
        if (dag.pages[at % n].group !== null) resident[at] ^= 1;
      }
      const { drawn } = cut(resident),
        moved = resident.filter((value, at) => value !== was[at]).length;
      assert.equal(cut.reads() - before, moved, `frame ${frame}`);
      // Read by difference, the cut is the one a view entering now draws.
      assert.deepEqual(sorted(drawn), sorted(mount(name)(resident).drawn), `frame ${frame}`);
    }
  });

  test(`${name}: a placement leaving the view lets its readiness go, the total exact`, () => {
    const roots = placements(dag, 2),
      cut = mount(name, roots),
      resident = residency(random(3));
    cut(resident);
    const both = cut.held.bytes;
    assert.equal(cut.held.placements, 2);
    // The second placement leaves, and its pages move while it is away: none of it is held.
    roots[1].worldBox = AWAY;
    cut(resident);
    for (let page = n + 1; page < 2 * n; page += 3) resident[page] = 1;
    const { drawn } = cut(resident);
    assert.equal(cut.held.placements, 1);
    const alone = placements(dag, 2);
    alone[1].worldBox = AWAY;
    const fresh = mount(name, alone);
    assert.deepEqual(sorted(drawn), sorted(fresh(resident).drawn));
    assert.equal(cut.held.bytes, fresh.held.bytes, 'what the first placement holds, no more');
    assert.ok(cut.held.bytes < both);
    // Back in view, it is read whole again; everything gone, nothing is held.
    roots[1].worldBox = undefined;
    assert.deepEqual(sorted(cut(resident).drawn), sorted(mount(name)(resident).drawn));
    assert.equal(cut.held.placements, 2);
    // A placement whose hierarchy changed enters again: its old state leaves the total.
    (roots[0] as { structure: object }).structure = { ...dag.structure };
    cut(resident);
    const again = mount(name);
    again(resident);
    assert.equal(cut.held.bytes, again.held.bytes);
    for (const root of roots) root.worldBox = AWAY;
    cut(resident);
    assert.deepEqual([cut.held.placements, cut.held.bytes], [0, 0]);
  });
}

test('both layouts let the feed route every move; a layout that does not is counted', () => {
  const setup = { roots: placements(dag, 2), bootstrap: [], cap: 64, pageBytes: 64 };
  const webgpu = createWebgpuPagesLayout(setup as unknown as WebgpuPagesSetup).selectionRoots;
  const shuffled = placements(dag, 2),
    [a, b] = shuffled[1].pages;
  [a.packedIndex, b.packedIndex] = [b.packedIndex, a.packedIndex];
  const routed = (cut: ReturnType<typeof cpuBackend>) => {
    const next = random(4);
    for (let frame = 0; frame < 4; frame++) cut(residency(next));
    return cut.held.unroutedReads;
  };
  assert.equal(routed(cpuBackend(dag, THRESHOLD, webgpu)), 0, 'the WebGPU layout');
  assert.equal(routed(webgl2Backend(dag, THRESHOLD, placements(dag, 2))), 0, 'the WebGL2 layout');
  assert.equal(routed(cpuBackend(dag, THRESHOLD, shuffled)), 3, 'read whole at each later visit');
});
