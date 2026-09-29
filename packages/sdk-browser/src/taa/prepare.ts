import { TAA_HISTORY_BYTES_PER_PIXEL, createTemporalAntialiasing } from './temporalAntialiasing.ts';
import { dropTaaHistory, forgetTaaHistory } from './frame.ts';
import { grantCapability } from '../webgpu/pages/io/drops.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { isCancelled } from '../backend/common.ts';
import { mainViewGpu, viewGpu, type WebgpuView } from '../webgpu/pages/state/view.ts';
import { TAA_CAPABILITIES } from './capability.ts';

/**
 * Rig temporal antialiasing after deferred lighting. The host can refuse it
 * (`temporalAntialiasing: false`): nothing is then created, and the image stays sampled at
 * the pixel centre. A device that rejects the program leaves the capability unsupported and
 * the image as before — never a false image. A session that may draw below the display
 * (`renderScale`) also compiles the resolves that reconstruct it
 * (`../webgpu/pages/state/renderScale.ts`).
 */
export async function prepareTemporalAntialiasing(rt: WebgpuPagesRuntime, device: GPUDevice) {
  rt.gpu.temporalWanted = rt.context.temporalAntialiasing !== false;
  if (rt.gpu.temporalWanted) await rigTemporalAntialiasing(rt, device);
}

async function rigTemporalAntialiasing(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, capabilities } = rt;
  try {
    const temporal = await createTaa(rt, device);
    // The main view's, even when a capture is drawn aside once the program has compiled.
    const main = mainViewGpu(rt);
    // Switched off, rigged by an earlier call or closed while the program compiled: not kept.
    if (!gpu.temporalWanted || main.temporal || isCancelled(rt.signal)) return temporal.dispose();
    main.temporal = temporal;
    for (const item of TAA_CAPABILITIES) grantCapability(capabilities, item);
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
  // A barrier (`settlePose`) before the next ordinary image replays the checkpoint: it must not
  // bring back the history of the images before the switch, on any view.
  for (const history of [
    temporal,
    ...rt.views.persistent.map((view) => viewGpu(rt, view).temporal),
  ]) {
    forgetTaaHistory(history);
    if (!history) continue;
    history.frame.sampledRank = 0;
    history.checkpoint(false);
  }
  if (on && temporal) {
    for (const item of TAA_CAPABILITIES) grantCapability(capabilities, item);
  } else if (on && gpu.device) {
    void rigTemporalAntialiasing(rt, gpu.device).then(
      () => {
        joinTargets(mainViewGpu(rt));
        for (const view of rt.views.persistent)
          rigViewTemporal(rt, view).catch(
            (error: unknown) =>
              isCancelled(rt.signal) ||
              rt.diag.diagnosticFailure('temporal-antialiasing-unavailable', error),
          );
        rt.run.gate.resourcesChanged();
      },
      () => {},
    );
  } else if (!on) {
    for (const item of TAA_CAPABILITIES)
      if (!capabilities.unsupported.includes(item)) capabilities.unsupported.push(item);
  }
  rt.run.gate.resourcesChanged();
}

/** The history joins the view's targets as they stand, a capture drawn aside meanwhile or not;
 *  unallocated, `makeTargets` counts it. */
function joinTargets(gpu: WebgpuView['gpu']) {
  const { temporal } = gpu;
  if (temporal && gpu.colorTexture && temporal.resize(...gpu.displaySize))
    gpu.targetBytes += temporal.historyBytes;
}

/** A persistent view's own pass and history, when the main view accumulates: never another
 *  view's history, never a capture's (`../webgpu/pages/state/persistentView.ts`). */
export async function rigViewTemporal(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const device = rt.gpu.device;
  if (!device || !mainViewGpu(rt).temporal || viewGpu(rt, view).temporal) return;
  const temporal = await createTaa(rt, device);
  const gpu = viewGpu(rt, view);
  // Removed, closed or rigged meanwhile: not kept.
  if (!rt.views.persistent.includes(view) || isCancelled(rt.signal) || gpu.temporal)
    return temporal.dispose();
  gpu.temporal = temporal;
  joinTargets(gpu);
  rt.run.gate.resourcesChanged();
}

/** A pass for this session: with the resolves that reconstruct the display when it draws below. */
const createTaa = (rt: WebgpuPagesRuntime, device: GPUDevice) =>
  createTemporalAntialiasing(device, rt.layout.selectionRoots, rt.scale.bounds.min < 1);

/** The pass leaves the session: capabilities dropped, cause named, image as before the batch. */
function dropTemporalAntialiasing(rt: WebgpuPagesRuntime, error: unknown) {
  const main = mainViewGpu(rt);
  main.temporal?.dispose();
  main.temporal = undefined;
  rt.capabilities.unsupported.push(...TAA_CAPABILITIES);
  rt.diag.diagnosticFailure('temporal-antialiasing-unavailable', error);
}

/**
 * History targets for the display size, and their bytes. They follow resolution
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
