// drive-a-car's shadow scene: its sun under its chase camera at 960 × 600, every page the view
// reads around the car drawn. The fixture of `carPages.test.ts` and the engine's idle-vehicle test.
import type { ShadowViewpoint } from '../light/contracts.ts';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { shadowPoolSide } from './virtual.ts';
import { SUN, VIEW, cycle, sunPages } from './lightShadow.fixture.ts';

/** drive-a-car's chase camera, 7.5 m behind the car and 2.4 m up, at 960 × 600. */
export const CHASE = {
  ...VIEW,
  position: [0, 2.4, 7.5] as const,
  pixelNear: VIEW.pixelNear * 1.2,
} satisfies ShadowViewpoint;

/** The example's sun, every page the chase view reads around the car drawn, finer near it: its
 *  store and its plan. */
export function chaseSun() {
  const store = createSceneLightStore(),
    plan = createShadowPlan(shadowPoolSide(960, 600));
  const toward = [-40, -70, -25].map((a) => a / Math.hypot(40, 70, 25));
  store.add({ ...SUN, direction: toward as [number, number, number] });
  let read: number[] = [];
  cycle(plan, store, 0, () => read, CHASE);
  const slice = store.sliceOf(0),
    around = (n: number) =>
      Array.from({ length: n * n }, (_, i) => [((i / n) | 0) - n / 2, (i % n) - n / 2]);
  read = [5, 6, 7, 8].flatMap((step, i) =>
    sunPages(plan, slice, plan.sun.finest[slice] + step, around([24, 16, 16, 8][i])),
  );
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, () => read, CHASE);
  return { store, plan };
}
