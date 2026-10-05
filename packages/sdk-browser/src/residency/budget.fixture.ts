// The default budgets the residency tests weigh against, as the engine computes them on its
// default canvas (`DEFAULT_BUDGET_CANVAS`).
import { DEFAULT_BUDGET_CANVAS, defaultGpuBudget } from './memoryBudget.ts';
import { effectTargetReserve } from './effectReserve.ts';
import { vsmLayout, vsmResourceBytes } from '../vsm/resources.ts';
import { VSM_RENDER_PAIR_CAPACITY } from '../vsm/renderPass.ts';
import { VSM_RENDER_CMD_BYTES, VSM_RENDER_PAIR_BYTES } from '../vsm/renderCullWgsl.ts';
import { vsmTransmissionBytes } from '../vsm/transmissionPass.ts';

/** The GPU total by default, on the default canvas. */
export const DEFAULT_GPU_BUDGET = defaultGpuBudget();
/** The effect targets' reserve on the default canvas. */
export const EFFECT_TARGET_BYTES = effectTargetReserve(DEFAULT_BUDGET_CANVAS);

/** The virtual shadow maps of one sun on a device whose storage bindings hold `binding` bytes, at
 *  the default pool, summed from their parts: every buffer of the set, the raster's pair and
 *  command lists at their ceiling, the coloured transmission's first atlas. What
 *  `SHADOW_POOL_BYTES` is held to (`shadowBudgetBytes.ts`). */
export function oneSunShadowMaps(binding = 128 * 1024 * 1024) {
  const layout = vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 }, binding);
  const lists = VSM_RENDER_PAIR_CAPACITY * (VSM_RENDER_PAIR_BYTES + VSM_RENDER_CMD_BYTES);
  return { layout, bytes: vsmResourceBytes(layout) + lists + vsmTransmissionBytes(layout) };
}
