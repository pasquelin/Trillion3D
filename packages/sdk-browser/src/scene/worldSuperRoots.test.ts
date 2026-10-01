// The world super-roots drawn by the ONE cut (#1238): a cell's super-root stands in for its
// per-instance roots when those are not resident, and the surface is covered exactly once across a
// cell's arrival and departure. Driven by the cook's own table shape — `worldRootsDag`, a
// world-roots.json fixture extended with the `clusters` and `groups` keys #1238 adds — read through
// the runtime's `worldRootDag`, and proved on the CPU oracle and the kernel's own WGSL text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldRootDag } from './worldSuperRoots.ts';
import { worldRootsDag } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts';
import { oracleBackend, wgslBackend } from '../page/cut/cutRuleBackends.fixture.ts';
import { ruleChecks } from '../page/cut/cutRuleChecks.fixture.ts';
import { coverFault, ruleDag, type RuleDag } from '../page/cut/cutRule.fixture.ts';
import { cullingBounds } from '../page/cut/bounds.ts';
import { packDagSelection } from '../gpu/dag/pack.ts';
import { DAG_SELECTION_SHADER } from '../gpu/dag/shader/shader.ts';

const THRESHOLD = 0.1;

/** The world DAG the cook publishes, as the runtime reads it (`worldRootDag`), with the group that
 *  replaces each cluster and the leaf units it covers attached, so a coverage check can read them. */
function worldDag(): RuleDag {
  const { clusters, groups, leaves } = worldRootsDag();
  const owner = new Array<number | null>(clusters.length).fill(null);
  for (const [at, group] of groups.entries()) for (const child of group.children) owner[child] = at;
  const root = worldRootDag({ clusters, groups, payload: { url: 'world-roots.bin' } })!;
  // The cut's `RulePage` reads a world page as the cook names it: a cluster carries no manifest
  // `source`, and its `material` is a manifest index, not the surface `DagCluster` holds.
  const pages = root.pages.map((page, at) => ({
    ...page,
    ...clusters[at],
    group: owner[at],
    source: null,
    material: undefined,
  })) as RuleDag['pages'];
  const culling = {
    ...root.culling!,
    bounds: cullingBounds(root.culling!, pages),
  } as RuleDag['culling'];
  // The cut's `RuleDag` reads the world's sixteen floats as a `Float64Array`; the runtime's world
  // matrix is the identity, read host by host (`MatrixElements`).
  const world = { elements: Float64Array.from(root.world.elements) };
  return { ...root, structure: root.structure!, pages, culling, world, leaves };
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

test('the engine packing holds a manifest root and the world DAG in one cut (#1238)', () => {
  const manifest = ruleDag(8),
    world = worldDag();
  // `packDagSelection` is the one packing the runtime uses (`webgpu/pages/prepare/prepare.ts`):
  // the world DAG rides beside the manifest primitives as one more root, not a second selection.
  const packed = packDagSelection([manifest, world]);
  assert.equal(packed.worldCount, 2);
  assert.equal(packed.pageCount, manifest.pages.length + world.pages.length);
  // Each root's cut links point at its own pages, after the ones packed before it.
  assert.equal(packed.cutLinks[0].pageBase, 0);
  assert.equal(packed.cutLinks[0].pageCount, manifest.pages.length);
  assert.equal(packed.cutLinks[1].pageBase, manifest.pages.length);
  assert.equal(packed.cutLinks[1].pageCount, world.pages.length);
  // The world DAG's group structure is packed with it: its residency reads it in the one cut.
  assert.ok(packed.cutLinks[1].structure, 'the world DAG carries its structure into the packing');
});

test('the world DAG is read in the cook’s rank order, never re-sorted (#1238)', () => {
  const { clusters, groups } = worldRootsDag();
  const root = worldRootDag({ clusters, groups, payload: { url: 'world-roots.bin' } })!;
  // Rank r is cluster r: a super-root names its page at its bundle, an object root none.
  assert.deepEqual(
    root.pages.map((page) => page.url),
    clusters.map(({ bundle, offset }) =>
      bundle === null ? '' : `world-roots.bin#${bundle}:${offset}`,
    ),
  );
  assert.deepEqual(root.structure!.roots, [clusters.length - 1], 'the world top is the root');
  // Two clusters out of their rank: the groups would name the wrong ones, so the table is refused.
  const swapped = [...clusters];
  [swapped[3], swapped[12]] = [swapped[12], swapped[3]];
  assert.throws(() => worldRootDag({ clusters: swapped, groups }), /WORLD_CLUSTER_RANK: 12 at 3/);
  assert.equal(worldRootDag({}), undefined, 'a table cooked without its DAG has none');
});
