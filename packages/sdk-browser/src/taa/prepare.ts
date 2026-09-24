import { TAA_HISTORY_BYTES_PER_PIXEL, createTemporalAntialiasing } from './temporalAntialiasing.ts';
import { dropTaaHistory } from './frame.ts';
import { grantCapability } from '../webgpu/pages/io/drops.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { isCancelled } from '../backend/common.ts';

/** The two capabilities the pass serves: antialiasing, and the motion vectors it
 *  derives from the visibility buffer. Unsupported until it is rigged. */
export const TAA_CAPABILITY = 'temporal antialiasing';
export const MOTION_CAPABILITY = 'motion vectors';

/**
 * Rig temporal antialiasing, once, after deferred lighting. The host can refuse it
 * (`temporalAntialiasing: false`): nothing is then created, and the image stays sampled at
 * the pixel centre. A device that rejects the program leaves the capability unsupported and
 * the image as before — never a false image.
 */
export async function prepareTemporalAntialiasing(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, context, capabilities } = rt;
  if (context.temporalAntialiasing === false) return;
  try {
    gpu.temporal = await createTemporalAntialiasing(device, rt.layout.selectionRoots);
    grantCapability(capabilities, TAA_CAPABILITY);
    grantCapability(capabilities, MOTION_CAPABILITY);
  } catch (error) {
    if (isCancelled(rt.signal)) throw error;
    dropTemporalAntialiasing(rt, error);
  }
}

/** The pass leaves the session: capabilities dropped, cause named, image as before the batch. */
function dropTemporalAntialiasing(rt: WebgpuPagesRuntime, error: unknown) {
  rt.gpu.temporal?.dispose();
  rt.gpu.temporal = undefined;
  rt.capabilities.unsupported.push(TAA_CAPABILITY, MOTION_CAPABILITY);
  rt.diag.diagnosticFailure('temporal-antialiasing-unavailable', error);
}

/**
 * History targets for the current image size, and their bytes. They follow resolution
 * like the other targets: no budget makes them leave. A surface capture renders from
 * another camera and does not accumulate: its targets do not touch the view's history,
 * which stays whole for the frame that follows restore.
 */
export function ensureTaaTargets(rt: WebgpuPagesRuntime, width: number, height: number) {
  const temporal = rt.gpu.temporal;
  if (!temporal) return 0;
  // Under a capture, the capture's reserve already carries history: it is not counted twice.
  if (rt.capture.capturing) return 0;
  if (temporal.resize(width, height)) dropTaaHistory(rt);
  return width * height * TAA_HISTORY_BYTES_PER_PIXEL;
}
