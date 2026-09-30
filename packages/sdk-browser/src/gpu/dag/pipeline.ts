import { dagSelectionShader } from './shader/splitWgsl.ts';
import { dagPartCounts, type DagSplit } from './split.ts';
import { dagBindEntries, type dagGroupEntries } from './shader/bindings.ts';
import { withScreenErrorVariant } from './shader/error.ts';
import { screenErrorVariant } from '../../../../sdk-core/src/index.ts';
import { validated } from '../core/errorScope.ts';
import { shaderFailed } from '../core/shaderModule.ts';
import type { CameraFrames } from './frameRanges.ts';
import { createDagStages } from './stages.ts';

/** The selection stages, and one bind group per range of `frames` with its primitive count, under
 *  one validation scope. `split`, the tables in parts on this device (`split.ts`): the layout binds
 *  every part, and the text reads across them. */
export function createDagPipeline(
  device: GPUDevice,
  buffers: Omit<Parameters<typeof dagGroupEntries>[0], 'frames' | 'worlds'>,
  frames: CameraFrames,
  split?: DagSplit,
) {
  return validated(device, async () => {
    const layout = device.createBindGroupLayout({
      entries: dagBindEntries(split && dagPartCounts(split)),
    });
    // The screen-error variant is frozen at shader compile: it no longer changes from session
    // open to session close, and the default text is rendered character for character
    // (`withScreenErrorVariant`).
    const module = device.createShaderModule({
      code: withScreenErrorVariant(dagSelectionShader(split), screenErrorVariant()),
    });
    if (await shaderFailed(module)) return undefined;
    const stages = await createDagStages(device, layout, module, frames.ranges.length > 1);
    const ranges = frames.bindGroups(layout, buffers);
    return {
      /** Bind layout, returned with the stages: the dispatch bench mounts the previous cut on
       *  EXACTLY this one, instead of retyping a fourth copy. */
      layout,
      ...stages,
      ranges,
    };
  });
}
