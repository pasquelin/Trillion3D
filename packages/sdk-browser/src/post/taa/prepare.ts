import { velocityWpo } from './velocityWpo.ts'
import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import { temporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/materialOptions.ts'
import { isTaaLevelOn } from './levels.ts'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { taaTargetBytes } from './historyTargets.ts'
import { wantedShapeOf } from './historyShape.ts'
import { executionOf } from './waveOps.ts'
import { readTemporalSetting } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { track } from '../../lighting/deferred/compileLedger.ts'
import type { FrameSize } from '../../frame/backend/state/renderScale.ts'
import { dropTaaHistory } from './landing.ts'
import { grantCapability } from '../../frame/io/drops.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { isCancelled } from '../../session/engine/common.ts'
import { mainViewGpu, viewGpu, type WebgpuView } from '../../frame/backend/state/view.ts'
import { taaWanted } from '../../frame/backend/state/gpu.ts'
import { TAA_CAPABILITIES } from './capability.ts'
import { velocityOf } from './velocityFrame.ts'

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
 * during the session, no session reopened. Another level while on keeps the pass, its knobs
 * written into the next image's uniform (`TAA_LEVEL_KNOBS`), and asks a frame: a held view draws
 * again, its convergence counted anew (`resourcesSeen`); an image that runs the flicker measure
 * after one that did not drops the history itself (`encodeTaaPass`), and so does one whose level
 * asks another history — its size, the frames it keeps, whether it reprojects by the field —, which
 * the image makes again (`historyShapeOf`). Turned on or off, the history is dropped either way. Off, the next image is sampled at the pixel centre, the history's targets are
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
  if (isTaaLevelOn(was) && on) {
    // Another level may ask another history: made now, the programs it needs asked before the next image.
    joinTargets(rt, gpu)
    return void rt.run.gate.resourcesChanged()
  }
  dropTaaHistory(temporal?.frame)
  if (temporal) {
    if (on) joinTargets(rt, gpu)
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

/**
 * The temporal pass of every view that holds one made again over the offsets of `rt.vis.rasters`, a
 * graph with an offset having joined the session: its programs place the vertices of a pixel's
 * triangle by the offsets they were made with. The old pass goes with the velocity stage it read and
 * its history, which starts again.
 */
export async function rigTemporalAgain(rt: WebgpuPagesRuntime, device: GPUDevice) {
  for (const view of [rt.views.main, ...rt.views.persistent]) {
    const gpu = viewGpu(rt, view),
      { velocity, temporal } = gpu
    if (!velocity || velocity.wpo.programs === rt.vis.rasters.offsets) continue
    if (temporal) {
      releaseHistory(gpu)
      temporal.dispose()
      gpu.temporal = undefined
    }
    velocity.dispose()
    gpu.velocity = undefined
    if (temporal) await rigViewTemporal(rt, view, device)
  }
}

/** The history joins the view's targets as they stand, a capture drawn aside meanwhile or not, made
 *  as the level and the settings ask (`historyShapeOf`): one that is another history than the one
 *  held — a level of another size — replaces it, its history dropped, the bytes the targets count
 *  following; unallocated, `makeTargets` counts it. The programs the history needs are asked here,
 *  off the frame. */
function joinTargets(rt: WebgpuPagesRuntime, gpu: WebgpuView['gpu']) {
  const { temporal } = gpu
  if (!temporal || !gpu.hdrTexture) return
  const shape = wantedShapeOf(rt, temporal, gpu.temporalLevel, ...gpu.displaySize)
  const before = temporal.historyBytes
  if (!temporal.resize(shape, ...gpu.allocatedSize)) return
  dropTaaHistory(temporal.frame)
  gpu.targetBytes += temporal.historyBytes - before
}

/** The history leaves the view's targets, its bytes with it; the pass and its programs stay. */
function releaseHistory(gpu: WebgpuView['gpu']) {
  const { temporal } = gpu
  if (!temporal) return
  gpu.targetBytes = Math.max(0, gpu.targetBytes - temporal.historyBytes)
  temporal.release()
}

/** `view`'s own pass and history, when it accumulates — the main view's, a persistent view's
 *  (`../../frame/backend/state/persistentView.ts`), or a capture's own when `aside`
 *  (`../../frame/io/captureAside.ts`, its history the capture's alone, released with its view) —:
 *  never another view's history. The history joins the view's targets as they stand. Whether the
 *  pass was kept. */
export async function rigViewTemporal(
  rt: WebgpuPagesRuntime,
  view: WebgpuView,
  device = rt.gpu.device,
  aside = false,
) {
  const wanted = viewGpu(rt, view)
  if (!device || !taaWanted(wanted) || wanted.temporal) return false
  // The velocity stage the pass reads its vectors and its last image from, the view's own.
  const temporal = await createTemporalAntialiasing(
    device,
    velocityOf(wanted, device, velocityWpo(rt.vis.rasters)),
    executionOf(rt, device),
    readTemporalSetting(rt, 'temporalHistoryPacked'),
  )
  const gpu = viewGpu(rt, view)
  // Switched off, rigged, removed or closed while the program compiled: not kept.
  const removed = !aside && view !== rt.views.main && !rt.views.persistent.includes(view)
  if (!taaWanted(gpu) || gpu.temporal || removed || isCancelled(rt.signal)) {
    temporal.dispose()
    return false
  }
  gpu.temporal = temporal
  joinTargets(rt, gpu)
  // A capture's pass changes nothing the other views draw.
  if (!aside) rt.run.gate.resourcesChanged()
  return true
}

/** Views whose pass is being made again for the history formats the setting asks. */
const remaking = new WeakSet<object>()

/**
 * The pass of every view that holds `temporal` made again in the history formats
 * `temporalHistoryPacked` asks now (its programs and targets are made for one set of formats): the
 * old pass goes with its history, which starts again, while the frames wait for the new.
 */
export function remakeTemporalFormats(rt: WebgpuPagesRuntime, temporal: object) {
  const device = rt.gpu.device
  if (!device || remaking.has(temporal)) return
  remaking.add(temporal)
  const views = [rt.views.main, ...rt.views.persistent].filter(
    (view) => viewGpu(rt, view).temporal === temporal,
  )
  const remake = (async () => {
    // Not within the image that asked: its encoding still holds the old pass.
    await Promise.resolve()
    for (const view of views) {
      const gpu = viewGpu(rt, view)
      releaseHistory(gpu)
      gpu.temporal?.dispose()
      gpu.temporal = undefined
      await rigViewTemporal(rt, view, device)
    }
  })()
    .catch((error: unknown) => {
      if (!isCancelled(rt.signal)) dropTemporalAntialiasing(rt, error)
    })
    .finally(() => remaking.delete(temporal))
  track(device, remake, true)
}

/** The pass leaves the session: capabilities dropped, cause named, image without the pass. */
function dropTemporalAntialiasing(rt: WebgpuPagesRuntime, error: unknown) {
  const main = mainViewGpu(rt)
  main.temporal?.dispose()
  main.temporal = undefined
  rt.capabilities.unsupported.push(...TAA_CAPABILITIES)
  rt.diag.diagnosticFailure('temporal-antialiasing-unavailable', error)
}

/**
 * History targets for the display size of `size`, at the level's percent of it, the analysis and
 * spatial anti-aliaser's for its render size, and their bytes (`taaTargetBytes`). They follow resolution
 * like the other targets: no budget makes them leave; switched off, they are not made
 * (`setWebgpuTemporalAntialiasing` makes them when it is on again). A capture drawn aside holds a
 * pass of its own only while it accumulates (`startCaptureAccumulation`): its targets are funded and
 * made with that history like any view's, and none otherwise; the main view's history stays whole
 * for the frame that follows the restore. `aside`: targets made beside those in
 * place (`targetsAside.ts`), which the frames still draw into: counted, not made — the swap that
 * puts them in place makes them (`swapAsideTargets`).
 */
export function ensureTaaTargets(rt: WebgpuPagesRuntime, size: FrameSize, aside = false) {
  const temporal = rt.gpu.temporal
  if (!temporal || !taaWanted(rt.gpu)) return 0
  const { width, height, renderWidth, renderHeight } = size
  const shape = wantedShapeOf(rt, temporal, rt.gpu.temporalLevel, width, height)
  if (!aside && temporal.resize(shape, renderWidth, renderHeight))
    dropTaaHistory(rt.gpu.temporal?.frame)
  return taaTargetBytes(size, shape)
}
