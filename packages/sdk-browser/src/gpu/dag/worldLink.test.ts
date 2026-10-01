// #1333: one DAG across the world and its objects, on the runtime path. The rows a partition takes
// and parks name the world object they place and their pose (`flipWorld`), the world bundles held
// go to the cut too (`holdWorldBundles`), and each placed object's roots link to their world ranks
// (`worldLinks.ts`): across a cell's arrival and departure, and a world group partly ready, the cut
// covers every leaf of BOTH DAGs exactly once — a cell by its super-root or by its objects, never
// both and never neither —, on the kernel's CPU oracle and on its own WGSL text, at every threshold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { packDagSelection } from './pack.ts';
import { createDagResources } from './resources.ts';
import { createDagRuntime } from './runtime.ts';
import { childBase, residentBase } from './layout.ts';
import { residentFlags } from './layout.fixture.ts';
import { packedWorldsToRenderOrigin } from './pack.fixture.ts';
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts';
import { cameraSelectionUniforms } from '../core/selection.ts';
import { flipWorld } from '../../placement/webgpuPlacements.ts';
import { createPlacementRows, placementWorld } from '../../placement/rows.ts';
import { coverFault, type RuleDag } from '../../page/cut/cutRule.fixture.ts';
import { stripCamera } from '../../page/cut/cutRuleBackends.fixture.ts';
import { wgslText } from '../../page/cut/cutRuleText.fixture.ts';
import { CELLS, OBJECTS, PER_CELL, linkedWorld, objectPose, unitsOf } from './worldLink.fixture.ts';
import { SHADOW_LIMITS } from '../../webgpu/pages/testScenes.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** From every leaf drawn to the top drawn alone. */
const THRESHOLDS = [0.001, 0.02, 0.1, 0.5, 2, 10, 40, 1e4];

async function scene() {
  const fixture = linkedWorld(),
    { object, world } = fixture,
    rows = createPlacementRows(OBJECTS);
  rows.origins = Int32Array.from({ length: OBJECTS }, (_, o) => o);
  for (let o = 0; o < OBJECTS; o++) rows.matrices.set(objectPose(o), o * 16);
  const roots = Array.from({ length: OBJECTS }, (_, index) => ({
    world: placementWorld(rows, index),
    pages: object.pages,
    culling: object.culling,
    structure: object.structure,
    placement: { rows, index },
  }));
  const packed = packDagSelection([...roots, world]);
  const { device } = fakeDevice({ limits: SHADOW_LIMITS });
  const selection = createDagRuntime((await createDagResources(device, packed, true))!);
  const flip = flipWorld({ run: { gpuSelection: selection } } as never);
  const cam = stripCamera({ leaves: OBJECTS } as RuleDag);
  packedWorldsToRenderOrigin(packed, [...roots, world], cam.eye);
  /** The rows' residency flags, the scene's pages alone. */
  const flags = new Uint32Array(packed.cutLinks[OBJECTS].pageBase);
  const objectsOf = (cell: number) =>
    Array.from({ length: PER_CELL }, (_, i) => cell * PER_CELL + i);
  /** Cell `cell`'s rows taken, or parked, as its placement writes them and the backend hands on. */
  const place = (cell: number, taken: boolean) => {
    for (const o of objectsOf(cell)) {
      rows.live[o] = taken ? 1 : 0;
      flip(o, { ...roots[o], parked: !taken });
    }
  };
  /** Objects `objects`' pages read into the pool (`resident`), or let go. */
  const read = (objects: number[], resident = true) => {
    for (const o of objects) flags.fill(resident ? 1 : 0, ...span(o));
    selection.updateResidency(flags);
  };
  const span = (o: number) => [packed.cutLinks[o].pageBase, packed.cutLinks[o + 1].pageBase];
  /** What the cut draws at threshold `t`, on the residency the cut uploaded, as the oracle or as
   *  the kernel's text decides; and the packed pages each leaf unit is drawn by. */
  const cut = (t: number, kernelText: boolean) => {
    const bits = new Uint32Array(packed.pageCones.buffer, packed.pageCones.byteOffset),
      { pageCount } = packed;
    const residency = {
      ready: residentFlags(bits, pageCount, residentBase(pageCount)),
      childReady: residentFlags(bits, pageCount, childBase(pageCount)),
    };
    const text = kernelText ? wgslText(packed) : undefined;
    const uniforms = cameraSelectionUniforms(cam, t, [1280, 720]);
    const drawn = evaluateDagSelectionKernel(
      packed,
      uniforms,
      residency,
      false,
      text?.rule,
      text?.links,
    ).drawablePageIds!;
    const pages = drawn.map((page) => ({ units: unitsOf(fixture, packed, page) }));
    return { drawn, fault: coverFault({ leaves: fixture.leaves, pages }, pages.keys()) };
  };
  return { fixture, packed, selection, place, read, objectsOf, span, cut };
}

test('a cell is drawn by its super-root or its objects, never both nor neither, on both DAGs (#1333)', async () => {
  const { fixture, packed, selection, place, read, objectsOf, span, cut } = await scene();
  const worldBase = packed.cutLinks[OBJECTS].pageBase,
    superRoot = (cell: number) => worldBase + fixture.superRoots[cell];
  /** At the finest threshold, the pages drawn over cell `cell`'s objects. */
  const cellDrawn = (drawn: number[], cell: number) => {
    const [from] = span(cell * PER_CELL),
      [, to] = span((cell + 1) * PER_CELL - 1);
    return drawn.filter((page) => (page >= from && page < to) || page === superRoot(cell));
  };
  const own = (drawn: number[], cell: number) =>
    cellDrawn(drawn, cell).filter((p) => p < worldBase);
  assert.equal(selection.packsWorld, true);
  assert.equal(selection.holdWorldBundles!(1, [1, 2, 3]), true, 'the cut takes the bundles');
  for (const cell of [0, 1]) {
    place(cell, true);
    read(objectsOf(cell));
  }
  /** Each step, then what the finest cut must draw over each cell: its objects, or its super-root. */
  const steps: [string, () => void, ('own' | 'super' | 'top')[]][] = [
    ['cells 0 and 1 near, cell 2 far, its object pages unread', () => {}, ['own', 'own', 'super']],
    ['cell 2 placed, its pages unread', () => place(2, true), ['own', 'own', 'super']],
    ['cell 2 drawable', () => read(objectsOf(2)), ['own', 'own', 'own']],
    [
      'one object of cell 1 let go: its group partly ready',
      () => read([5], false),
      ['own', 'super', 'own'],
    ],
    ['it comes back', () => read([5]), ['own', 'own', 'own']],
    ['cell 0 gone far', () => place(0, false), ['super', 'own', 'own']],
    [
      'cell 0 let go, the top stands in',
      () => selection.holdWorldBundles!(1, [2, 3]),
      ['top', 'top', 'top'],
    ],
  ];
  for (const [name, step, finest] of steps) {
    step();
    for (const kernelText of [false, true]) {
      const where = `${name}, ${kernelText ? 'WGSL' : 'oracle'}`;
      for (const t of THRESHOLDS)
        assert.equal(
          cut(t, kernelText).fault,
          -1,
          `${where}, t=${t}: a leaf not drawn exactly once`,
        );
      const { drawn } = cut(THRESHOLDS[0], kernelText);
      finest.forEach((by, cell) => {
        const expected = by === 'super' ? [superRoot(cell)] : by === 'top' ? [] : own(drawn, cell);
        assert.deepEqual(cellDrawn(drawn, cell), expected, `${where}: cell ${cell} drawn by ${by}`);
        if (by === 'own') assert.ok(expected.length > 0, `${where}: cell ${cell} has own pages`);
      });
      if (finest.includes('top')) assert.deepEqual(drawn, [worldBase + fixture.top], where);
    }
  }
  // Seen from afar, the objects' roots read their world parent: the top alone covers the world.
  assert.deepEqual(cut(1e4, true).drawn, [worldBase + fixture.top]);
  assert.equal(CELLS, 3);
});
