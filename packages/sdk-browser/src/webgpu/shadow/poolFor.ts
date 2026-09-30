import {
  shadowPoolSide,
  shadowPoolShape,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import type { PoolClamp } from '../../residency/pools.ts';
import { SHADOW_ATLAS_BYTES } from '../../residency/shadowBudgetBytes.ts';

/** The smallest shadow pool: the side a one-pixel screen asks (`shadowPoolSide`). */
const FLOOR_SIDE = shadowPoolSide(1, 1);

/** The shadow pool `budgetBytes` holds for a screen that asks `wanted` pages: the fewest layers
 *  that hold what fits, of the largest side that fits, never below the floor. Short of `wanted`
 *  at the memory budget's atlas bytes (`SHADOW_ATLAS_BYTES`), the budget holds it, not the device. */
export const shadowPoolFor = (wanted: number, layerSide?: number) => (budgetBytes: number) => {
  const pages = Math.min(wanted, Math.floor(budgetBytes / shadowAtlasBytes(1)));
  const { side: full, layers } = shadowPoolShape(pages, layerSide),
    fits = Math.floor(Math.sqrt(budgetBytes / shadowAtlasBytes(1, layers)));
  const floor = Math.min(FLOOR_SIDE, shadowPoolShape(wanted, layerSide).side),
    side = Math.max(floor, Math.min(full, fits));
  const held = budgetBytes >= SHADOW_ATLAS_BYTES ? 'ceiling' : 'device-limit';
  const clamp: PoolClamp =
    side <= FLOOR_SIDE ? 'minimum' : side * side * layers < wanted ? held : null;
  return { budgetBytes, side, layers, allocatedBytes: shadowAtlasBytes(side, layers), clamp };
};
