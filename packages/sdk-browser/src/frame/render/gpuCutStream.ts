import { cpuNow } from '../../diagnostic/stopwatch.ts'
import { pumpResidentTiles } from '../prepare/lightResources.ts'
import { warmWorldActors } from '../prepare/hlodWarm.ts'
import { followTexturePressure, growWebgpuRootRegion } from '../io/memory.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The cut of the drawn view: the main one, or the view's own beside it on the same tables
 *  (`../../geometry/dag/aside.ts`), made at its first image. None for a scene without a cluster. */
export function cutOf({ run, views }: WebgpuPagesRuntime) {
  const selection = run.gpuSelection
  if (!selection || views.active === views.main) return selection
  return (run.asideCut ??= selection.aside())
}

/**
 * What advances an image's stream: ask the cache for the pages the views' cuts want, bring the
 * clusters' records level with the pool (`syncClusters`), then publish residency flags to the GPU
 * cut.
 */
export function streamCutResidency(rt: WebgpuPagesRuntime, _gpuDevice: GPUDevice) {
  const { run, services } = rt,
    { clusters } = rt.layout,
    marks = rt.timing.marks,
    selection = run.gpuSelection
  // The frame's streaming update: what does not fit is drawn by its nearest resident ancestor
  // (`../../geometry/residency/queue.ts`). Root pages the root region lacks grains for grow it.
  services.queueCutResidency()
  const short = services.residency.rootsShort
  if (short) growWebgpuRootRegion(rt, short)
  marks.queueEnd = cpuNow()
  services.syncClusters()
  run.clustersSyncedFrame = run.frame
  marks.clustersEnd = cpuNow()
  // The rank journal names pages that just entered or left: comparing every page of the DAG
  // no longer happens, and only their ranges are rewritten.
  if (selection?.updateResidency(clusters.residency, clusters.residencyChanges))
    run.gpuMetricsReady = false
  clusters.clearResidencyChanges()
  marks.residencyUploadEnd = cpuNow()
  // The world's HLOD switches wait for the actors they draw to warm: the tiles those ask are
  // served in this pass beside the feedback's (`../prepare/hlodWarm.ts`).
  warmWorldActors(rt)
  // What the previous image's feedback requested of the textures becomes resident, on what the
  // cluster records left of the frame's clock: a page without its record draws a coarser ancestor — a
  // hole where a window was —, a tile not in yet only a coarser level. The pass times itself on its budget
  // clock, the one bound the textures stage reads. A tile served is a resource change. A lane that
  // found no place for a tile grows its pool, which is a resource change when it lands.
  if (pumpResidentTiles(rt.vis.textures, run.frame, run.textureConverging))
    run.gate.resourcesChanged()
  void followTexturePressure(rt)
  marks.tilesEnd = cpuNow()
}

/**
 * The cut of the drawn view into the frame's `encoder`: the main cut, or the view's own beside it
 * (`../../geometry/dag/aside.ts`), made at its first image. Returns false when no cut ran — the
 * cut's tables being made again —: the list of visible clusters is the cut's own output, so an image
 * with no cut would draw a list left empty by the growth or the last cut's main pass alone: the view
 * keeps the image it has. A scene without a cluster has nothing to cut.
 */
export function dispatchCut(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { run, timing } = rt,
    cut = cutOf(rt)
  if (!cut) return true
  timing.frameSelection = cut.dispatch(run.selectionUniforms, encoder)
  return !!timing.frameSelection
}

/**
 * Sending the selection of an image waiting for its root cover. Nothing is drawn before it, but the
 * wait cannot settle for rereading the last sample: without a new send, the same sample comes back
 * every image and the cut stays stuck on it, camera still, even once the missing bytes have
 * arrived. The selection is sent in a command buffer of its own; no draw pass goes with it.
 *
 * Returns false when the send fails, said here once per lost send: the image is skipped, and a
 * view drawn aside drops its cut (`gpuCut.ts`); only `device.lost` declares the device lost.
 */
export function dispatchWaitingSelection(rt: WebgpuPagesRuntime) {
  const { run, gpu } = rt
  try {
    // Its own command buffer, sent only when the cut encoded something into it.
    const encoder = gpu.device!.createCommandEncoder()
    const settle = cutOf(rt)!.dispatch(run.selectionUniforms, encoder)
    if (settle) {
      gpu.device!.queue.submit([encoder.finish()])
      settle(true)
    }
    return true
  } catch (error) {
    rt.diag.diagnosticFailure('gpu-selection-dispatch-failed', error)
    return false
  }
}
