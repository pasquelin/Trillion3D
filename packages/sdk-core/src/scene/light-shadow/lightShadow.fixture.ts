// The viewpoint and the sun the shadow-plan tests share — an eye five units up looking down -Z, a
// sun straight overhead that casts —, and what stands in for the shading: a request report that
// names the pages a frame read, stamped as the engine stamps it.
import type { SceneLight, ShadowViewpoint } from '../light/contracts.ts';
import { createSceneLightStore, type SceneLightStore } from '../light/store.ts';
import { createShadowPlan, type ShadowPlan } from './plan.ts';
import { LAMP_MIPS, SUN_LEVELS, lampEntry, sunEntry } from './virtual.ts';

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

const SCENE_MIN = [-50, 0, -50],
  SCENE_MAX = [50, 10, 50];

/** The fixture's view moved by `step` hairs: no extent moves by a page, the camera does not rest. */
export const nudged = (step: number): ShadowViewpoint => ({
  ...VIEW,
  position: [VIEW.position[0] + step * 1e-6, VIEW.position[1], VIEW.position[2]],
});

/** Plans a frame over the fixture scene. */
export const planFrame = (
  plan: ShadowPlan,
  store: SceneLightStore,
  frame: number,
  view: ShadowViewpoint = VIEW,
) => plan.plan(store, view, SCENE_MIN, SCENE_MAX, frame, frame * 16);

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
) {
  planFrame(plan, store, frame, view);
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

/** The sun, planned once so its slice and clipmap exist, its floor drawn: its store, its plan and
 *  its slice. */
export function sunScene() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  store.add(SUN);
  planFrame(plan, store, 0);
  plan.commit();
  return { store, plan, slice: store.sliceOf(0) };
}

/** A point lamp three units up that casts, planned once: its store, its plan and its slice. */
export function lampScene() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  store.add({ ...SUN, id: 'lamp', kind: 'point', position: [0, 3, 0], range: 20 });
  planFrame(plan, store, 0);
  return { store, plan, slice: store.sliceOf(0) };
}
