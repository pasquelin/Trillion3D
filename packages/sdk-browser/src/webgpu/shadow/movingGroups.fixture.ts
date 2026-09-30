// The batch the moving-group tests draw (#1345): a pool of 51² pages, four sun pages in two
// blocks, one alone in a third, and a lamp's page, all restored.
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { DRAW_DYNAMIC } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import {
  LAMP,
  SUN,
  VIEW,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { planPagePasses } from './pagePasses.ts';

/** A pool of 51² pages, 6 528 texels a side: its blocks are 4 096 texels, at its start or end. */
export const SIDE = 51,
  CAPACITY = 10;
/** Two sun pages in the first block, two in the right one, one alone in the bottom one, a lamp's. */
export const PAGES = [0, 1, 40, 41, 40 * SIDE, 5];
/** Each region's kept casters, opaque then cutout, and the corners each list draws. */
export const KEPT = [
  [3, 1, 30, 12],
  [2, 0, 45, 0],
  [1, 2, 9, 20],
  [0, 0, 0, 0],
];

/** The batch, its sun's pages and its lamp's in one pool pass. */
export function batch() {
  const lights = createWebgpuLightState(SIDE);
  lights.store.add(SUN);
  lights.store.add(LAMP);
  lights.plan.plan(lights.store, VIEW, [-10, 0, -10], [10, 5, 10], 0, 0);
  const volumes = new Float32Array(MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS);
  for (const [i, page] of PAGES.entries()) {
    lights.plan.pool.slice[page] = lights.store.sliceOf(i === 5 ? 1 : 0);
    lights.regions.push(page, DRAW_DYNAMIC, volumes, new Uint32Array(volumes.buffer));
  }
  planPagePasses(lights.regions, PAGES.length);
  return { lights, rt: { lights } as unknown as WebgpuPagesRuntime };
}
