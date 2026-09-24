// The viewpoint and the sun the shadow-plan tests share — an eye five units up looking down -Z, a
// sun straight overhead that casts —, and what stands in for the shading: a request report that
// names the pages a frame read, stamped as the engine stamps it.
import type { SceneLight, ShadowViewpoint } from '../light/contracts.ts';
import type { SceneLightStore } from '../light/store.ts';
import type { ShadowPlan } from './plan.ts';
import { lampEntry, sunEntry } from './virtual.ts';

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

/** Table entries of every page of lamp `face` at `mip`, for the light in `slice`. */
export function lampPages(plan: ShadowPlan, slice: number, face: number, mip: number) {
  const side = 32 >> mip,
    entries: number[] = [];
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++)
      entries.push(plan.table.baseOf(slice) + lampEntry(face, mip, x, y));
  return entries;
}

/**
 * The engine's frame loop, reduced to the scheduler: plan, commit what was admitted, then report
 * what the shading read. Returns the pages drawn.
 */
export function cycle(
  plan: ShadowPlan,
  store: SceneLightStore,
  frame: number,
  read: () => number[],
  view: ShadowViewpoint = VIEW,
) {
  const drawn = planFrame(plan, store, frame, view);
  plan.commit();
  report(plan, store, frame, read());
  return drawn;
}
