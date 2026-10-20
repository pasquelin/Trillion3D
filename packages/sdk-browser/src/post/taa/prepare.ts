import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import { temporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/materialOptions.ts'
import { isTaaLevelOn } from './levels.ts'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { taaTargetBytes } from './historyTargets.ts'
import type { FrameSize } from '../../frame/backend/state/renderScale.ts'
import { dropTaaHistory } from './landing.ts'
import { grantCapability } from '../../frame/io/drops.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { isCancelled } from '../../session/engine/common.ts'
import { mainViewGpu, viewGpu, type WebgpuView } from '../../frame/backend/state/view.ts'
import { taaWanted } from '../../frame/backend/state/gpu.ts'
import { TAA_CAPABILITIES } from './capability.ts'

/**
 * Rig temporal antialiasing after deferred lighting, at the level the host asks
 * (`temporalAntialiasing`). The host can refuse it
 * (`temporalAntialiasing: false` or `'off'`): nothing is then created, and the image stays sampled at
 * the pixel centre. A device that rejects the program leaves the capability unsupported and
 * the image without it — never a false image. A session that may draw below the display
 * (`renderScale`) also compiles the resolves that reconstruct it
 * (`../../frame/backend/state/renderScale.ts`).
 */
export async function prepareTemporalAntialiasing(rt: WebgpuPagesRuntime, device: GPUDevice) {
  rt.gpu.temporalLevel = temporalAntialiasingLevel(rt.context.temporalAntialiasing)
  if (taaWanted(rt.gpu)) await rigMainTemporal(rt, device)
}

/** The main view's pass (`rigViewTemporal`), even when a capture is drawn aside once the program
 *  has compiled: the world's capabilities are granted with it, and a device that refuses it drops
 *  them (`dropTemporalAntialiasing`). */
async function rigMainTemporal(rt: WebgpuPagesRuntime, device: GPUDevice) {
  try {
    if (await rigViewTemporal(rt, rt.views.main, device))
      for (const item of TAA_CAPABILITIES) grantCapability(rt.capabilities, item)
  } catch (error) {
    if (isCancelled(rt.signal)) throw error
    dropTemporalAntialiasing(rt, error)
  }
}

/**
 * Sets the pass of `view` — the main one by default, whose switch is the world's — to `level`
 * during the session, no session reopened. Another level while on keeps the pass and its history
 * — no level changes a target's format or size —, its knobs written into the next image's uniform
 * (`TAA_LEVEL_KNOBS`), and asks a frame: a held view draws again, its convergence counted anew
 * (`resourcesSeen`); an image that runs the flicker measure after one that did not drops the
 * history itself (`encodeTaaPass`). Turned on or off, the history is dropped either way. Off, the next image is sampled at the pixel centre, the history's targets are
 * released — no byte of them is kept off — and the program is kept, so that on again is
 * immediate: the targets are made again at the view's size, the first image a cut. On in a session
 * opened without it, the program is rigged in the background and the images stay unjittered until
 * it is ready. The capability says which the image is. The frame's own targets follow
 * (`../../frame/backend/state/renderScale.ts`): off, the images are drawn at the render scale's
 * maximum, which nothing rebuilds below and the composition upscales; a switch remakes the targets
 * only where that changes their size.
 */
export function setWebgpuTemporalAntialiasing(
  rt: WebgpuPagesRuntime,
  level: TemporalAntialiasingLevel,
  view: WebgpuView = rt.views.main,
) {
  const { capabilities } = rt,
    // A capture drawn aside meanwhile holds none: the pass is the view's, wherever it is held.
    gpu = viewGpu(rt, view),
    { temporal } = gpu,
    was = gpu.temporalLevel,
    on = isTaaLevelOn(level)
  if (was === level) return
  gpu.temporalLevel = level
  if (isTaaLevelOn(was) && on) return void rt.run.gate.resourcesChanged()
  dropTaaHistory(temporal?.frame)
  if (temporal) {
    if (on) joinTargets(gpu)
    else releaseHistory(gpu)
  }
  if (view !== rt.views.main) {
    // A view beside the main one rigs a pass of its own the first time it is turned on.
    if (on && !temporal)
      void rigViewTemporal(rt, view).catch(
        (error: unknown) =>
          isCancelled(rt.signal) ||
          rt.diag.diagnosticFailure('temporal-antialiasing-unavailable', error),
      )
  } else if (on && temporal) {
    for (const item of TAA_CAPABILITIES) grantCapability(capabilities, item)
  } else if (on && rt.gpu.device) {
    void rigMainTemporal(rt, rt.gpu.device).catch(() => {})
  } else if (!on) {
    for (const item of TAA_CAPABILITIES)
      if (!capabilities.unsupported.includes(item)) capabilities.unsupported.push(item)
  }
  rt.run.gate.resourcesChanged()
}

/** The history joins the view's targets as they stand, a capture drawn aside meanwhile or not;
 *  unallocated, `makeTargets` counts it. */
function joinTargets(gpu: WebgpuView['gpu']) {
  const { temporal } = gpu
  if (temporal && gpu.hdrTexture && temporal.resize(...gpu.displaySize, ...gpu.allocatedSize))
    gpu.targetBytes += temporal.historyBytes
}

/** The history leaves the view's targets, its bytes with it; the pass and its programs stay. */
function releaseHistory(gpu: WebgpuView['gpu']) {
  const { temporal } = gpu
  if (!temporal) return
  gpu.targetBytes = Math.max(0, gpu.targetBytes - temporal.historyBytes)
  temporal.release()
}

/** `view`'s own pass and history, when it accumulates — the main view's, or a persistent view's
 *  (`../../frame/backend/state/persistentView.ts`) —: never another view's history, never a
 *  capture's. The history joins the view's targets as they stand. Whether the pass was kept. */
export async function rigViewTemporal(
  rt: WebgpuPagesRuntime,
  view: WebgpuView,
  device = rt.gpu.device,
) {
  const wanted = viewGpu(rt, view)
  if (!device || !taaWanted(wanted) || wanted.temporal) return false
  const temporal = await createTaa(rt, device)
  const gpu = viewGpu(rt, view)
  // Switched off, rigged, removed or closed while the program compiled: not kept.
  const removed = view !== rt.views.main && !rt.views.persistent.includes(view)
  if (!taaWanted(gpu) || gpu.temporal || removed || isCancelled(rt.signal)) {
    temporal.dispose()
    return false
  }
  gpu.temporal = temporal
  joinTargets(gpu)
  rt.run.gate.resourcesChanged()
  return true
}

/** A pass for this session: its resolves reconstruct the display at every render scale. */
const createTaa = (rt: WebgpuPagesRuntime, device: GPUDevice) =>
  createTemporalAntialiasing(device, rt.layout.selectionRoots)

/** The pass leaves the session: capabilities dropped, cause named, image without the pass. */
function dropTemporalAntialiasing(rt: WebgpuPagesRuntime, error: unknown) {
  const main = mainViewGpu(rt)
  main.temporal?.dispose()
  main.temporal = undefined
  rt.capabilities.unsupported.push(...TAA_CAPABILITIES)
  rt.diag.diagnosticFailure('temporal-antialiasing-unavailable', error)
}

/**
 * History targets for the display size of `size`, the analysis and spatial anti-aliaser's for its
 * render size, and their bytes (`taaTargetBytes`). They follow resolution
 * like the other targets: no budget makes them leave; switched off, they are not made
 * (`setWebgpuTemporalAntialiasing` makes them when it is on again). A surface capture renders
 * from another camera and does not accumulate: its targets do not touch the view's history,
 * which stays whole for the frame that follows restore. `aside`: targets made beside those in
 * place (`targetsAside.ts`), which the frames still draw into: counted, not made — the swap that
 * puts them in place makes them (`swapAsideTargets`).
 */
export function ensureTaaTargets(rt: WebgpuPagesRuntime, size: FrameSize, aside = false) {
  const temporal = rt.gpu.temporal
  if (!temporal || !taaWanted(rt.gpu)) return 0
  // Under a capture, the capture's reserve already carries history: it is not counted twice.
  if (rt.capture.capturing) return 0
  const { width, height, renderWidth, renderHeight } = size
  if (!aside && temporal.resize(width, height, renderWidth, renderHeight))
    dropTaaHistory(rt.gpu.temporal?.frame)
  return taaTargetBytes(size)
}
