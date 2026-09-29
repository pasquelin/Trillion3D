// The scene of #1209's tests: a plan over lights planned once, the floor receivers under the
// fixture's camera, and whether an entry reads a drawn page.
import type { SceneLight, ShadowViewpoint } from '../../../../sdk-core/src/index.ts';
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import { createShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import { PAGE_MAPPED, PAGE_VALID } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import {
  LAMP,
  VIEW,
  planFrame,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { viewPlanes } from './demand.fixture.ts';

export const LAMP_AHEAD: SceneLight = { ...LAMP, position: [0, 3, -12] };
export const MIN = [-50, 0, -50],
  MAX = [50, 10, 50];

/** A plan of 32² pages over `lights`, planned once: its store and its plan. */
export function demandScene(lights: SceneLight[]) {
  const store = createSceneLightStore(),
    plan = createShadowPlan(32);
  for (const light of lights) store.add(light);
  planFrame(plan, store, 0);
  plan.commit();
  return { store, plan };
}

/** What the host hands the plan: the receivers' boxes under `view`, a pixel at the near plane
 *  `pixelNear` wide for every pass, or `most` for the coarsest. */
export const receiversOf = (
  boxes: Float64Array,
  view: ShadowViewpoint = VIEW,
  most = view.pixelNear,
) => ({
  boxes,
  count: boxes.length / 6,
  planes: viewPlanes(view),
  pixelNear: view.pixelNear,
  pixelNearMost: most,
  orthographic: false,
});

export const readable = (plan: ReturnType<typeof createShadowPlan>, entry: number) =>
  (plan.table.words[entry] & (PAGE_MAPPED | PAGE_VALID)) === (PAGE_MAPPED | PAGE_VALID);
