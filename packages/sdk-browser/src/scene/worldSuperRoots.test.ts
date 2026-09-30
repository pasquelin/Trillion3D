// The world super-roots drawn by the ONE cut (#1238): a cell's super-root stands in for its
// per-instance roots when those are not resident, and the surface is covered exactly once across a
// cell's arrival and departure. Proved on the CPU oracle and on the kernel's own WGSL text, through
// the engine's existing shapes (`buildWorldSuperRootRoot`, `packDagSelection`,
// `evaluateDagSelectionKernel`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldSuperRootRoot, type WorldSuperRootCluster } from './worldSuperRoots.ts';
import { oracleBackend, wgslBackend } from '../page/cut/cutRuleBackends.fixture.ts';
import { ruleChecks } from '../page/cut/cutRuleChecks.fixture.ts';
import { coverFault } from '../page/cut/cutRule.fixture.ts';
import { DAG_SELECTION_SHADER } from '../gpu/dag/shader/shader.ts';

const THRESHOLD = 0.1;

type WorldCluster = WorldSuperRootCluster & {
  units: [number, number];
  group: number | null;
  source: number | null;
};

/**
 * A world of three cells along x, each four object roots (level 0), continued into one cell
 * super-root (level 1) and one world top (level 2): the shape the cook publishes (#1188), ordered
 * by its world rank. `group` names the cluster's owner group (null on the world top), `source` the
 * group that produced it, `units` the leaf units each covers, so coverage can be checked.
 */
function worldDag() {
  const cells = 3,
    per = 4,
    leaves = cells * per,
    e1 = 0.05,
    e2 = 0.5;
  const clusters: WorldCluster[] = [];
  const groups: { level: number; error: number; sphere: number[]; children: number[]; outputs: number[] }[] = [];
  for (let cell = 0; cell < cells; cell++)
    for (let i = 0; i < per; i++) {
      const u = cell * per + i;
      clusters.push({
        cluster: u,
        url: `cell${cell}/root${i}`,
        level: 0,
        lodError: 0,
        sphere: [u + 0.5, 0, 0, 0.5],
        parentError: e1,
        parentSphere: [cell * per + 2, 0, 0, 2],
        min: [u, -0.25, -0.25],
        max: [u + 1, 0.25, 0.25],
        triangles: 2,
        units: [u, u + 1],
        group: cell,
        source: null,
      });
    }
  for (let cell = 0; cell < cells; cell++) {
    const cluster = clusters.length;
    clusters.push({
      cluster,
      url: `cell${cell}`,
      level: 1,
      lodError: e1,
      sphere: [cell * per + 2, 0, 0, 2],
      parentError: e2,
      parentSphere: [leaves / 2, 0, 0, leaves / 2],
      min: [cell * per, -0.25, -0.25],
      max: [(cell + 1) * per, 0.25, 0.25],
      triangles: 2 * per,
      units: [cell * per, (cell + 1) * per],
      group: cells,
      source: cell,
    });
    groups.push({
      level: 1,
      error: e1,
      sphere: [cell * per + 2, 0, 0, 2],
      children: [cell * per, cell * per + 1, cell * per + 2, cell * per + 3],
      outputs: [cluster],
    });
  }
  const top = clusters.length;
  clusters.push({
    cluster: top,
    url: 'world-top',
    level: 2,
    lodError: e2,
    sphere: [leaves / 2, 0, 0, leaves / 2],
    parentError: null,
    parentSphere: null,
    min: [0, -0.25, -0.25],
    max: [leaves, 0.25, 0.25],
    triangles: 2 * leaves,
    units: [0, leaves],
    group: null,
    source: cells,
  });
  groups.push({
    level: 2,
    error: e2,
    sphere: [leaves / 2, 0, 0, leaves / 2],
    children: [leaves, leaves + 1, leaves + 2],
    outputs: [top],
  });
  const root = buildWorldSuperRootRoot(clusters, groups);
  const pages = root.pages.map((page, at) => ({ ...page, ...clusters[at] }));
  return { ...root, structure: root.structure!, pages, leaves };
}
type WorldDag = ReturnType<typeof worldDag>;

/** The drawn page covering leaf unit `unit`, or -1 when none covers it. */
function coverAt(dag: WorldDag, drawn: readonly number[], unit: number) {
  for (const page of drawn) {
    const [a, b] = dag.pages[page].units;
    if (a <= unit && unit < b) return page;
  }
  return -1;
}

/** Cell 2 far: every page resident save its object roots (units 8..12), the super-roots and the
 *  world top held. */
const FAR_CELL = new Uint8Array(16).fill(1);
[8, 9, 10, 11].forEach((page) => (FAR_CELL[page] = 0));

for (const [name, backend] of [
  ['the CPU oracle', oracleBackend],
  ['the WGSL kernel text', wgslBackend],
] as const) {
  const dag = worldDag();

  test(`${name} draws a far cell's super-root in place of its per-instance roots (#1238)`, () => {
    const cut = backend(dag, THRESHOLD)(FAR_CELL);
    assert.equal(coverFault(dag, cut.drawn), -1, 'a leaf is not covered exactly once');
    // The near cells' object roots draw, the far cell's do not (they are not resident, never read).
    for (let unit = 0; unit < 8; unit++) assert.equal(coverAt(dag, cut.drawn, unit), unit);
    for (let unit = 8; unit < 12; unit++) assert.equal(coverAt(dag, cut.drawn, unit), 14);
    // The far cell's object pages are never read: not resident, and not among what is drawn.
    for (const page of [8, 9, 10, 11]) {
      assert.equal(FAR_CELL[page], 0, `object page ${page} is read`);
      assert.ok(!cut.drawn.includes(page), `object page ${page} is drawn`);
    }
    // The super-root stands in, the coarser world top does not.
    assert.ok(cut.drawn.includes(14), 'the far cell super-root is not drawn');
    assert.ok(!cut.drawn.includes(15), 'the world top drew over the resident super-roots');
  });

  test(`${name} covers every leaf exactly once across a cell's arrival and departure (#1238)`, () => {
    ruleChecks(dag).randomFrames(backend(dag, THRESHOLD));
  });
}

test('the WGSL proof cannot go green without the missing-finer-group term', () => {
  const dag = worldDag();
  const forgets = DAG_SELECTION_SHADER.replaceAll('(ownWithin||!childResident)', 'ownWithin');
  assert.notEqual(forgets, DAG_SELECTION_SHADER, 'the rule is not in the kernel');
  assert.throws(
    () => ruleChecks(dag).randomFrames(wgslBackend(dag, THRESHOLD, forgets)),
    /not covered exactly once|drawn by/,
  );
});
