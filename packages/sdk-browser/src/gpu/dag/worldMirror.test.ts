// The world DAG's residency mirrors the scene's (#1332): packed beside the manifest primitives, the
// world DAG grows the packing past the rows' flags, which the cut refuses; the mirror hands it one
// array, its object roots resident while their placed object's root cover is. Across a cell's
// arrival and departure the cut, on the CPU oracle, covers every leaf exactly once: no hole, no
// double draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldResidencyMirror } from './worldMirror.ts';
import { packDagSelection } from './pack.ts';
import { createDagResources } from './resources.ts';
import { createDagRuntime } from './runtime.ts';
import { ruleDag, coverFault } from '../../page/cut/cutRule.fixture.ts';
import { oracleBackend } from '../../page/cut/cutRuleBackends.fixture.ts';
import { coverAt, worldDag } from '../../scene/worldSuperRoots.fixture.ts';
import { SHADOW_LIMITS } from '../../webgpu/pages/testScenes.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

const THRESHOLD = 0.1,
  OBJECTS = 12;

/** Twelve placements of one manifest primitive, object `o` on placement `o`, then the world DAG
 *  of three cells of four objects (`worldRootsDag`), packed last; its super-roots all held. */
function scene() {
  const world = worldDag(),
    manifest = ruleDag(8);
  const packed = packDagSelection([...Array.from({ length: OBJECTS }, () => manifest), world]);
  const mirror = createWorldResidencyMirror(packed, OBJECTS, world.origins);
  world.origins.forEach((origin, rank) => origin < 0 && mirror.superRoot(rank, true));
  const rows = new Uint32Array(packed.cutLinks[OBJECTS].pageBase);
  const { pageBase } = packed.cutLinks[OBJECTS];
  /** The world DAG's slice of the mirror, as the oracle reads it. */
  const worldResidency = () => Uint8Array.from(mirror.flags.subarray(pageBase));
  /** Placement `w`'s root cover resident, or not, in the rows' flags. */
  const cover = (w: number, resident: boolean) => {
    const { pageBase: base, structure } = packed.cutLinks[w];
    for (const root of structure!.roots) rows[base + root] = resident ? 1 : 0;
  };
  return { world, packed, mirror, rows, pageBase, worldResidency, cover };
}

test('the cut that packs the world DAG mirrors the rows itself; one without it reads them', async () => {
  const { packed, mirror, rows } = scene();
  const cutOf = async (dag: typeof packed) =>
    createDagRuntime(
      (await createDagResources(fakeDevice({ limits: SHADOW_LIMITS }).device, dag, true))!,
    );
  // The rows name the scene's pages alone, fewer than the packing holds: its mirror fills them.
  const selection = await cutOf(packed);
  assert.deepEqual([packed.world!.root, selection.packsWorld], [OBJECTS, true]);
  assert.equal(mirror.update(rows).flags.length, packed.pageCount);
  assert.doesNotThrow(() => selection.updateResidency(rows));
  assert.throws(
    () => selection.updateResidency(rows.subarray(1)),
    /GPU_SELECTION_RESIDENCY_COUNT_CHANGED/,
  );
  // Until #1333 packs it, no cut holds the world DAG: the rows go up as they are.
  const scenePacked = packDagSelection(Array.from({ length: OBJECTS }, () => ruleDag(8)));
  const plain = await cutOf(scenePacked);
  assert.deepEqual([scenePacked.world, plain.packsWorld], [undefined, false]);
  assert.doesNotThrow(() => plain.updateResidency(rows));
});

test('an object root is resident only while its object is placed and its root cover resident', () => {
  const { mirror, rows, pageBase, cover } = scene();
  mirror.place(3, 3);
  mirror.update(rows);
  assert.equal(mirror.flags[pageBase + 3], 0, 'placed, its cover not yet read');
  cover(3, true);
  const { changes } = mirror.update(rows);
  assert.equal(mirror.flags[pageBase + 3], 1, 'placed and drawable');
  // Only what moved is handed over, sorted: the cover's pages, then the object root.
  const moved = [...changes.pages.subarray(0, changes.count)];
  assert.deepEqual(
    moved,
    [...moved].sort((a, b) => a - b),
  );
  assert.ok(moved.includes(pageBase + 3));
  mirror.unplace(3);
  mirror.update(rows);
  assert.equal(mirror.flags[pageBase + 3], 0, 'its object left: the super-root stands in');
  assert.equal(mirror.update(rows).changes.count, 0, 'nothing moved, nothing handed over');
});

test('a cell coming near and going far is covered exactly once at every step (#1332)', () => {
  const { world, mirror, rows, worldResidency, cover } = scene();
  const cut = oracleBackend(world, THRESHOLD);
  /** Cells 0 and 1 near (their objects placed, covers resident), cell 2 far. */
  for (let o = 0; o < 8; o++) {
    mirror.place(o, o);
    cover(o, true);
  }
  const steps: [string, () => void][] = [
    ['cells 0 and 1 near, cell 2 far', () => {}],
    [
      'cell 2 placed, its covers not read yet',
      () => {
        for (let o = 8; o < 12; o++) mirror.place(o, o);
      },
    ],
    [
      'cell 2 drawable',
      () => {
        for (let o = 8; o < 12; o++) cover(o, true);
      },
    ],
    [
      'cell 0 gone far',
      () => {
        for (let o = 0; o < 4; o++) mirror.unplace(o);
      },
    ],
  ];
  const expected = [
    [0, 1, 2, 3, 4, 5, 6, 7, 14, 14, 14, 14],
    [0, 1, 2, 3, 4, 5, 6, 7, 14, 14, 14, 14],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    [12, 12, 12, 12, 4, 5, 6, 7, 8, 9, 10, 11],
  ];
  steps.forEach(([name, step], at) => {
    step();
    mirror.update(rows);
    const { drawn } = cut(worldResidency());
    assert.equal(coverFault(world, drawn), -1, `${name}: a leaf is not covered exactly once`);
    const units = Array.from({ length: OBJECTS }, (_, unit) => coverAt(world, drawn, unit));
    assert.deepEqual(units, expected[at], name);
  });
});
