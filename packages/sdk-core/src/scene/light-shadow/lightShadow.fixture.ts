// The viewpoint and the sun the shadow-plan tests share — an eye five units up looking down -Z, a
// sun straight overhead that casts —, and what stands in for the shading: a request report that
// names the pages a frame read, stamped as the engine stamps it.
import type { SceneLight, ShadowViewpoint } from '../light/contracts.ts';
import { createSceneLightStore, type SceneLightStore } from '../light/store.ts';
import { createShadowPlan, type ShadowPlan } from './plan.ts';
import { LAMP_MIPS, SUN_LEVELS, SUN_WINDOW, shadowTableStride } from './virtual.ts';
import { sunEntries } from './sunEntries.ts';
import { lampEntry, sunEntry } from './pageModel.ts';
import { SHADOW_CULL_FLOATS } from './faces.ts';
import { writeSunSquare } from './sunFaces.ts';

/** The table entries of every sun level at the default window. */
export const SUN_ENTRIES = sunEntries(SUN_WINDOW);
/** The table words one slice takes at the default window. */
export const SHADOW_TABLE_STRIDE = shadowTableStride(SUN_WINDOW);

export const VIEW: ShadowViewpoint = {
  position: [0, 5, 0],
  forward: [0, 0, -1],
  halfFovY: 0.6,
  aspect: 16 / 9,
  near: 0.1,
  far: 200,
  pixelNear: (0.1 * 2 * Math.tan(0.6)) / 720,
};

export const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
};

/** A point lamp three units up that casts. */
export const LAMP: SceneLight = {
  ...SUN,
  id: 'lamp',
  kind: 'point',
  position: [0, 3, 0],
  range: 20,
};

/** The fixture scene's box: a ground a hundred metres wide, ten metres deep. */
const SCENE_MIN = [-50, 0, -50],
  SCENE_MAX = [50, 10, 50];
/** A 12 × 12 square of pages round the camera, `[ax, ay]` each. */
export const SUN_GRID = Array.from({ length: 144 }, (_, i) => [
  (i % 12) - 6,
  Math.floor(i / 12) - 6,
]);

/** The fixture's view moved by `step` hairs: no extent moves by a page, the camera moves. */
export const nudged = (step: number): ShadowViewpoint => ({
  ...VIEW,
  position: [VIEW.position[0] + step * 1e-6, VIEW.position[1], VIEW.position[2]],
});

/** Plans a frame over the fixture scene, or the scene of box `min..max`. */
export const planFrame = (
  plan: ShadowPlan,
  store: SceneLightStore,
  frame: number,
  view: ShadowViewpoint = VIEW,
  min: ArrayLike<number> = SCENE_MIN,
  max: ArrayLike<number> = SCENE_MAX,
) => plan.plan(store, view, min, max, frame, frame * 16);

/** The report the shading of `frame` writes when it reads `entries`, stamped with the plan. */
export function report(plan: ShadowPlan, store: SceneLightStore, frame: number, entries: number[]) {
  plan.receive({
    frame,
    layoutEpoch: plan.table.layoutEpoch,
    stamp: plan.stamp(store),
    count: entries.length,
    entries: Uint32Array.from(entries),
  });
}

/** Table entries of sun pages `[ax, ay]` at `level`, for the light in `slice`. */
export const sunPages = (plan: ShadowPlan, slice: number, level: number, pages: number[][]) =>
  pages.map(([ax, ay]) => plan.table.baseOf(slice) + sunEntry(level, ax, ay));

/** The cull volume of sun page `(ax, ay)` at `level`, for the light in `slice`, its projection put
 *  in `matrix` (`writeSunSquare`); the volume's first three floats are the page box's centre. */
export function sunPageVolume(
  plan: ShadowPlan,
  slice: number,
  level: number,
  ax: number,
  ay: number,
  matrix = new Float32Array(16),
) {
  const volume = new Float32Array(SHADOW_CULL_FLOATS);
  writeSunSquare(matrix, 0, volume, 0, plan.sun, slice, level, ax, ay);
  return volume;
}

/** Table entry of the sun's floor page over the camera of the fixture: the one page of its last
 *  level every fixture page lies under. Counted here, not read from the scheduler it tests. */
export const sunFloor = (plan: ShadowPlan, slice: number) =>
  sunPages(plan, slice, plan.sun.finest[slice] + SUN_LEVELS - 1, [[0, 0]])[0];

/** Table entry of lamp `face`'s floor page, its one-page mip. */
export const lampFloor = (plan: ShadowPlan, slice: number, face: number) =>
  plan.table.baseOf(slice) + lampEntry(face, LAMP_MIPS - 1, 0, 0);

/** Table entries of every page of lamp `face` at `mip`, for the light in `slice`. */
export function lampPages(plan: ShadowPlan, slice: number, face: number, mip: number) {
  const side = 32 >> mip,
    entries: number[] = [];
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++)
      entries.push(plan.table.baseOf(slice) + lampEntry(face, mip, x, y));
  return entries;
}

/** The engine's frame loop, reduced to the scheduler: plan, commit what was admitted, then report
 *  what the shading read. Returns the physical pages the frame drew. */
export function cycleDrawn(
  plan: ShadowPlan,
  store: SceneLightStore,
  frame: number,
  read: () => number[],
  view: ShadowViewpoint = VIEW,
  min: ArrayLike<number> = SCENE_MIN,
  max: ArrayLike<number> = SCENE_MAX,
) {
  planFrame(plan, store, frame, view, min, max);
  const drawn = new Set(plan.admission.list.subarray(0, plan.admission.count));
  plan.commit();
  report(plan, store, frame, read());
  return drawn;
}

/** `cycleDrawn`, returning how many pages the frame drew. */
export const cycle = (...args: Parameters<typeof cycleDrawn>) => cycleDrawn(...args).size;

/** The physical pages of the light in `slice` the shading reads now. */
export function readPages(plan: ShadowPlan, slice: number) {
  const { pool } = plan,
    pages: number[] = [];
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0 && pool.slice[page] === slice && pool.valid[page]) pages.push(page);
  return pages;
}

/** Table entries of the stale pages, in order. */
export function staleEntries(plan: ShadowPlan) {
  const { pool } = plan,
    entries: number[] = [];
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0 && pool.dirty[page]) entries.push(pool.owner[page]);
  return entries.sort((a, b) => a - b);
}

/** The sun, planned once so its slice and clipmap exist, its floor drawn: its store, its plan and
 *  its slice. */
export function sunScene(min: ArrayLike<number> = SCENE_MIN, max: ArrayLike<number> = SCENE_MAX) {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  store.add(SUN);
  planFrame(plan, store, 0, VIEW, min, max);
  plan.commit();
  return { store, plan, slice: store.sliceOf(0) };
}

/** The sun, its pages around the eye mapped and drawn over three frames of a view at rest: its
 *  store, its plan, the next frame and what a frame reads. */
export function settledSun() {
  const { store, plan, slice } = sunScene();
  const read = () => sunPages(plan, slice, plan.sun.finest[slice] + 6, [[0, 0]]);
  let frame = 1;
  for (; frame < 4; frame++) cycle(plan, store, frame, read);
  return { store, plan, frame, read };
}

/** A point lamp three units up that casts, planned once: its store, its plan and its slice. */
export function lampScene() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  store.add(LAMP);
  planFrame(plan, store, 0);
  return { store, plan, slice: store.sliceOf(0) };
}

/** A sun and a lamp planned over eight frames of a moving view: its store and its plan. */
export function movingScene() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(16);
  store.add(SUN);
  store.add(LAMP);
  for (let frame = 0; frame < 8; frame++) {
    const view = { ...VIEW, position: [frame * 3, 5, 0] as [number, number, number] };
    cycle(plan, store, frame, () => lampPages(plan, store.sliceOf(1), 0, frame % 3), view);
  }
  return { store, plan };
}
