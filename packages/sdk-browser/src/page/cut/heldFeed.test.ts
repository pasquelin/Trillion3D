// The cut rule's readiness follows the pool's residency feed (#483 rules 6 and 7, #486): a still
// view reads no page's residency, a change reads the pages that moved and no other, and a placement
// that leaves the view lets its readiness go, the running total exact. Counted, never timed: every
// residency answer a cut asks for. Run on the backends of `cutRule.test.ts`: the CPU cut, the WebGL2
// image's cut, and the GPU kernel's host, which both kernel backends share.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { AWAY, placements } from './cutRuleBackends.fixture.ts';
import { cpuBackend, webgl2Backend } from './cutRuleHosts.fixture.ts';
import { random } from './cutRuleChecks.fixture.ts';
import { packDagSelection } from '../../gpu/dag/pack.ts';
import { createDagReadiness } from '../../gpu/dag/readiness.ts';
import type { ClusterRoot, PageRec } from '../selection/types.ts';

const THRESHOLD = 0.1;
const dag = ruleDag(64),
  n = dag.pages.length;

type Probe = ((resident: Uint8Array) => { drawn: number[] }) & { reads: () => number };

/** The GPU kernel's host, handed the pages the rank journal names as flipped: it draws nothing
 *  here, its readiness is what is counted. */
function gpuBackend(_dag: unknown, _threshold: number, roots: ClusterRoot<PageRec>[]): Probe {
  const readiness = createDagReadiness(packDagSelection(roots)),
    now = new Uint8Array(roots.length * n);
  let reads = 0,
    first = true;
  const read = new Proxy(now, { get: (target, key) => (reads++, Reflect.get(target, key)) });
  const frame = (resident: Uint8Array) => {
    const pages = Int32Array.from(resident.keys()).filter((at) => resident[at] !== now[at]);
    now.set(resident);
    readiness.apply(read, first ? undefined : { pages, count: pages.length, sorted: true });
    first = false;
    return { drawn: [] };
  };
  return Object.assign(frame, { reads: () => reads });
}

const backends = {
  'CPU cut': cpuBackend,
  'WebGL2 cut': webgl2Backend,
  'GPU kernel host': gpuBackend,
};
/** `name`'s backend over two placements of the DAG, both in view. */
const mount = (name: keyof typeof backends, roots = placements(dag, 2)) =>
  backends[name](dag, THRESHOLD, roots);
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
}

// The GPU kernel's host holds the readiness of the pages the pool holds, whatever the view: only
// the two host cuts hold a state per placement they visit.
for (const name of ['CPU cut', 'WebGL2 cut'] as const) {
  test(`${name}: a placement leaving the view lets its readiness go, the total exact`, () => {
    const roots = placements(dag, 2),
      cut = backends[name](dag, THRESHOLD, roots),
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
    const fresh = backends[name](dag, THRESHOLD, alone);
    assert.deepEqual(sorted(drawn), sorted(fresh(resident).drawn));
    assert.equal(cut.held.bytes, fresh.held.bytes, 'what the first placement holds, no more');
    assert.ok(cut.held.bytes < both);
    // Back in view, it is read whole again; everything gone, nothing is held.
    roots[1].worldBox = undefined;
    assert.deepEqual(sorted(cut(resident).drawn), sorted(mount(name)(resident).drawn));
    assert.equal(cut.held.placements, 2);
    for (const root of roots) root.worldBox = AWAY;
    cut(resident);
    assert.deepEqual([cut.held.placements, cut.held.bytes], [0, 0]);
  });
}
