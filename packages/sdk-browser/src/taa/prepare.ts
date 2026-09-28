import { TAA_HISTORY_BYTES_PER_PIXEL, createTemporalAntialiasing } from './temporalAntialiasing.ts';
import { dropTaaHistory, forgetTaaHistory } from './frame.ts';
import { grantCapability } from '../webgpu/pages/io/drops.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { isCancelled } from '../backend/common.ts';
import { mainViewGpu } from '../webgpu/pages/state/view.ts';
import { MOTION_CAPABILITY, TAA_CAPABILITY } from './capability.ts';

/**
 * Rig temporal antialiasing after deferred lighting. The host can refuse it
 * (`temporalAntialiasing: false`): nothing is then created, and the image stays sampled at
 * the pixel centre. A device that rejects the program leaves the capability unsupported and
 * the image as before — never a false image.
 */
export async function prepareTemporalAntialiasing(rt: WebgpuPagesRuntime, device: GPUDevice) {
  rt.gpu.temporalWanted = rt.context.temporalAntialiasing !== false;
  if (rt.gpu.temporalWanted) await rigTemporalAntialiasing(rt, device);
}

async function rigTemporalAntialiasing(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, capabilities } = rt;
  try {
    const temporal = await createTemporalAntialiasing(device, rt.layout.selectionRoots);
    // The main view's, even when a capture is drawn aside once the program has compiled.
    const main = mainViewGpu(rt);
    // Switched off, rigged by an earlier call or closed while the program compiled: not kept.
    if (!gpu.temporalWanted || main.temporal || isCancelled(rt.signal)) return temporal.dispose();
    main.temporal = temporal;
    grantCapability(capabilities, TAA_CAPABILITY);
    grantCapability(capabilities, MOTION_CAPABILITY);
  } catch (error) {
    if (isCancelled(rt.signal)) throw error;
    dropTemporalAntialiasing(rt, error);
  }
}

/**
 * Turns the pass on or off during the session, no session reopened; the history is dropped
 * either way. Off, the next image is sampled at the pixel centre and the program is kept, so that
 * on again is immediate. On in a session opened without it, the program is rigged in the
 * background and the images stay unjittered until it is ready. The capability says which the
 * image is.
 */
export function setWebgpuTemporalAntialiasing(rt: WebgpuPagesRuntime, on: boolean) {
  const { gpu, capabilities } = rt,
    // The pass is the main view's: a capture drawn aside meanwhile holds none.
    { temporal } = mainViewGpu(rt);
  if (gpu.temporalWanted === on) return;
  gpu.temporalWanted = on;
  forgetTaaHistory(temporal);
  // A barrier (`settlePose`) before the next ordinary image replays the checkpoint: it must not
  // bring back the history of the images before the switch.
  if (temporal) {
    temporal.frame.sampledRank = 0;
    temporal.checkpoint(false);
  }
  if (on && temporal) {
    grantCapability(capabilities, TAA_CAPABILITY);
    grantCapability(capabilities, MOTION_CAPABILITY);
  } else if (on && gpu.device) {
    void rigTemporalAntialiasing(rt, gpu.device).then(
      () => {
        // The history joins the main view's targets as they stand, a capture drawn aside
        // meanwhile or not; unallocated, `makeTargets` counts it.
        const main = mainViewGpu(rt),
          rigged = main.temporal;
        if (rigged && main.colorTexture && rigged.resize(...main.targetSize))
          main.targetBytes += rigged.historyBytes;
        rt.run.gate.resourcesChanged();
      },
      () => {},
    );
  } else if (!on) {
    for (const item of [TAA_CAPABILITY, MOTION_CAPABILITY])
      if (!capabilities.unsupported.includes(item)) capabilities.unsupported.push(item);
  }
  rt.run.gate.resourcesChanged();
}

/** The pass leaves the session: capabilities dropped, cause named, image as before the batch. */
function dropTemporalAntialiasing(rt: WebgpuPagesRuntime, error: unknown) {
  const main = mainViewGpu(rt);
  main.temporal?.dispose();
  main.temporal = undefined;
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
