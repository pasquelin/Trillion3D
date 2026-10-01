// #1333: the world DAG's residency on the runtime path. The rows a partition takes and parks name
// the world-roots object they place (`PlacementRows.origins`); the WebGPU backend hands each flip
// to the cut (`flipWorld`), and the world bundles held go to it too (`holdWorldBundles`). The cut
// that packs the world DAG mirrors them, and its uploaded residency, read back as the kernel reads
// it, draws a cell by its super-root until its objects are drawable, then by its objects, on the
// CPU oracle and the kernel's own WGSL text: every leaf covered exactly once at every step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { packDagSelection } from './pack.ts';
import { createDagResources } from './resources.ts';
import { createDagRuntime } from './runtime.ts';
import { residentBase } from './layout.ts';
import { residentFlags } from './layout.fixture.ts';
import { flipWorld } from '../../placement/webgpuPlacements.ts';
import { createPlacementRows } from '../../placement/rows.ts';
import { ruleDag, coverFault } from '../../page/cut/cutRule.fixture.ts';
import { oracleBackend, wgslBackend } from '../../page/cut/cutRuleBackends.fixture.ts';
import { coverAt, worldDag } from '../../scene/worldSuperRoots.fixture.ts';
import { SHADOW_LIMITS } from '../../webgpu/pages/testScenes.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

const THRESHOLD = 0.1,
  OBJECTS = 12,
  PER_CELL = 4;

/** Twelve rows of one manifest primitive, row `o` placing object `o`, then the world DAG of three
 *  cells of four objects (`worldRootsDag`, a cell's super-root in bundle `cell + 1`), packed last
 *  in the one cut the runtime builds. */
async function scene() {
  const world = worldDag(),
    manifest = ruleDag(8),
    rows = createPlacementRows(OBJECTS);
  rows.origins = Int32Array.from({ length: OBJECTS }, (_, object) => object);
  const roots = Array.from({ length: OBJECTS }, (_, index) => ({
    ...manifest,
    placement: { rows, index },
  }));
  const packed = packDagSelection([...roots, world]);
  const { device } = fakeDevice({ limits: SHADOW_LIMITS });
  const selection = createDagRuntime((await createDagResources(device, packed, true))!);
  const flip = flipWorld({ run: { gpuSelection: selection } } as never);
  /** The rows' residency flags, the scene's pages alone. */
  const flags = new Uint32Array(packed.cutLinks[OBJECTS].pageBase);
  /** Cell `cell`'s rows taken, or parked, as its placement writes them and the backend hands on. */
  const place = (cell: number, taken: boolean) => {
    for (let o = cell * PER_CELL; o < (cell + 1) * PER_CELL; o++) {
      rows.live[o] = taken ? 1 : 0;
      flip(o, { ...roots[o], parked: !taken });
    }
  };
  /** Cell `cell`'s objects' root covers read into the pool. */
  const cover = (cell: number) => {
    for (let o = cell * PER_CELL; o < (cell + 1) * PER_CELL; o++) {
      const { pageBase, structure } = packed.cutLinks[o];
      for (const root of structure!.roots) flags[pageBase + root] = 1;
    }
    selection.updateResidency(flags);
  };
  /** The world DAG's residency the cut uploaded, read back where the kernel reads it. */
  const uploaded = () => {
    const bits = new Uint32Array(packed.pageCones.buffer, packed.pageCones.byteOffset);
    const ready = residentFlags(bits, packed.pageCount, residentBase(packed.pageCount));
    return Uint8Array.from(ready.subarray(packed.cutLinks[OBJECTS].pageBase));
  };
  return { world, selection, place, cover, uploaded };
}

test('the rows taken and parked and the bundles held feed the world DAG on the runtime path (#1333)', async () => {
  const { world, selection, place, cover, uploaded } = await scene();
  assert.equal(selection.packsWorld, true);
  // The pinned top (bundle 0) and the three cells' super-roots held; cells 0 and 1 drawable.
  assert.equal(selection.holdWorldBundles!(1, [1, 2, 3]), true, 'the cut takes the bundles');
  for (const cell of [0, 1]) {
    place(cell, true);
    cover(cell);
  }
  const steps: [string, () => void, number[]][] = [
    ['cells 0 and 1 near, cell 2 far', () => {}, [0, 1, 2, 3, 4, 5, 6, 7, 14, 14, 14, 14]],
    [
      'cell 2 placed, its covers unread',
      () => place(2, true),
      [0, 1, 2, 3, 4, 5, 6, 7, 14, 14, 14, 14],
    ],
    ['cell 2 drawable', () => cover(2), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
    ['cell 0 gone far', () => place(0, false), [12, 12, 12, 12, 4, 5, 6, 7, 8, 9, 10, 11]],
    // Its super-root's bundle let go, the pinned top stands in: coarser, never a hole.
    ['cell 0 let go', () => selection.holdWorldBundles!(1, [2, 3]), Array(OBJECTS).fill(15)],
  ];
  for (const [name, step, expected] of steps) {
    step();
    const resident = uploaded();
    // The CPU oracle, then the kernel's own WGSL text.
    for (const backend of [oracleBackend, wgslBackend]) {
      const { drawn } = backend(world, THRESHOLD)(resident);
      assert.equal(coverFault(world, drawn), -1, `${name}: a leaf is not covered exactly once`);
      const units = Array.from({ length: OBJECTS }, (_, unit) => coverAt(world, drawn, unit));
      assert.deepEqual(units, expected, name);
    }
  }
});
