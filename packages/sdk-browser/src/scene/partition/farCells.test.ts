// #1332: a partition's frame plans its cells through `createFarCells`. While no cut packs the world
// DAG the plan is the placed cells' own, the world DAG unread; once one does, the stream's bound is
// read once, and the cells the cut draws by their super-roots are held far, their bundles held.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createCellBoxes } from './boxes.ts';
import { createCellIndex } from './cellIndex.ts';
import { createFarCells } from './farCells.ts';
import { openAll, paged } from './paged.fixture.ts';
import { planCells } from './plan.ts';
import { cellSuperRootError } from './superRoots.ts';

const reach = 100,
  eye = [0, 0.5, 0.5],
  lens = { pixelScale: [800, 600] as [number, number], pixelError: 1, near: 0.1, slope: 1 };
const xs = [10, 30, 45, 70];
/** Each cell's super-roots: an error of 0.03 over the cell's own unit box. */
const bounds = Float64Array.from(xs.flatMap((x) => [0.03, x + 0.5, 0.5, 0.5, 0.5]));

/** Four cells of one box each, found through their index; a world that records its holds and
 *  serves the bound once its stream opens. */
function partition() {
  const boxes = createCellBoxes([], new Object3D(), []);
  boxes.refresh();
  const records = xs.map((x, at) => ({
    ...{ url: `${at}.json`, sha256: '', bytes: 1, meshes: [[0, 1] as const], meshPages: [] },
    parents: [[null, [x, 0, 0, x + 1, 1, 1]] as const],
  }));
  const { partition, files } = paged(records, 1);
  const index = createCellIndex(partition.pages, 'https://cache.test/', boxes);
  openAll(index, files);
  const world = { held: [] as number[], released: [] as number[], streams: 0 };
  const holder = {
    hold: async (cell: number) => void world.held.push(cell),
    release: (cell: number) => void world.released.push(cell),
    stream: async () => (world.streams++, { superRoots: bounds }) as never,
  };
  const placed = new Map<number, unknown>();
  return { index, world, placed, far: createFarCells(holder, placed) };
}
const local = { eye, reach };
const left: number[] = [];
const leave = (cell: number) => void left.push(cell);

test('while no cut packs the world DAG, the plan is the cells own and the DAG is unread', () => {
  const { index, world, placed, far } = partition();
  const plan = far.plan(index, local, eye, undefined, leave);
  assert.deepEqual(plan, planCells(index, eye, reach, placed));
  assert.deepEqual(plan.visible, [0, 1, 2, 3], 'every cell within reach has its objects read');
  assert.deepEqual([world.streams, world.held, plan.far], [0, [], []], 'nothing is held far');
});

test('once the cut packs it, the cells its super-roots draw are held far, their bundles held', async () => {
  const { index, world, placed, far } = partition();
  // The first frame asks the bound once; until it lands, the plan is unchanged.
  const first = far.plan(index, local, eye, lens, leave);
  assert.deepEqual(first, planCells(index, eye, reach, placed));
  far.plan(index, local, eye, lens, leave);
  assert.equal(world.streams, 1, 'the stream opens once');
  await Promise.resolve();
  const plan = far.plan(index, local, eye, lens, leave);
  assert.deepEqual(plan.far, [0, 1, 2, 3], 'every cell found is held by its super-roots');
  assert.deepEqual(world.held, plan.far, 'each holds its world bundles');
  // A cell whose super-roots move a shown pixel past the target has its objects read.
  const needed = xs.flatMap((_, cell) =>
    cellSuperRootError(bounds, cell, eye, lens) > lens.pixelError ? [cell] : [],
  );
  assert.ok(needed.length > 0 && needed.length < xs.length, 'near cells need objects, far do not');
  assert.deepEqual(plan.visible, needed);
  await new Promise(setImmediate); // the holds land
  // Placed since, a cell lets its far hold go; a cut that no longer packs the world DAG lets all go.
  placed.set(needed[0], {});
  far.plan(index, local, eye, lens, leave);
  assert.deepEqual(world.released, [needed[0]]);
  far.plan(index, local, eye, undefined, leave);
  assert.deepEqual(world.released.toSorted(), [0, 1, 2, 3]);
});

test('a placed cell the cut no longer needs is demoted, its world bundles held before it leaves', async () => {
  const { index, world, placed, far } = partition();
  // A target every cell's super-roots meet within the keep margin: a placed cell gives back its objects.
  const worst = Math.max(...xs.map((_, cell) => cellSuperRootError(bounds, cell, eye, lens)));
  const coarse = { ...lens, pixelError: 2 * worst };
  far.plan(index, local, eye, coarse, leave);
  await Promise.resolve();
  assert.deepEqual(far.plan(index, local, eye, coarse, leave).far, [0, 1, 2, 3]);
  await new Promise(setImmediate); // the holds land
  placed.set(0, {});
  const held = world.held.length;
  let holdsBeforeLeave = -1;
  const plan = far.plan(index, local, eye, coarse, (cell) => {
    holdsBeforeLeave = world.held.length - held;
    placed.delete(cell);
  });
  assert.deepEqual(plan.demoted, [0]);
  assert.deepEqual(world.held.slice(held), [0], 'the demoted cell is held far');
  // Its far hold is taken before its placed hold goes: the bundles both need are never released,
  // then read again.
  assert.equal(holdsBeforeLeave, 1);
});
