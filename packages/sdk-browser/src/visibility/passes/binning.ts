import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { chainReady } from '../../lighting/deferred/fullscreen.ts'
import type { RasterPass } from '../raster/contract.ts'
import type { BinningSteps } from '../raster/raster.ts'
import type { DecodeInputs } from '../decode/decode.ts'
import type { BinInputs } from '../bins/bins.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** What the steps of a pass's binning read, set before each binning and read only by its steps:
 *  nothing allocated on a replayed frame. */
const running = {
  rt: undefined as WebgpuPagesRuntime | undefined,
  pass: 0 as RasterPass,
}
const decodeInputs = {} as DecodeInputs
const binInputs = {} as BinInputs

const deformClusters = (run: ComputeRun) =>
  running.rt!.vis.deformationCode?.encodeDeformedClusters(running.rt!, run)

const steps: BinningSteps = {
  ready() {
    const { vis } = running.rt!
    return chainReady(...vis.gpuDecode!.chain(running.pass), ...vis.binStages!.chain(running.pass))
  },
  clear: (encoder) => running.rt!.vis.gpuBins!.clear(encoder),
  decode(compute) {
    const { vis, run, rootWorlds } = running.rt!
    const bins = vis.gpuBins!,
      cut = run.gpuSelection!
    decodeInputs.visible = cut.visible
    decodeInputs.info = cut.info
    decodeInputs.rootWorlds = rootWorlds!.worlds!
    decodeInputs.placements = vis.placementGpu!.buffer
    decodeInputs.outputs = vis.placementGpu!.outputs
    decodeInputs.pages = vis.pageTable!
    decodeInputs.work = bins.workBuffer
    decodeInputs.args = bins.argsBuffer
    vis.gpuDecode!.encode(compute, running.pass, decodeInputs)
  },
  bins(compute) {
    const { vis, run } = running.rt!
    binInputs.pages = vis.pageTable!
    binInputs.visible = run.gpuSelection!.visible
    binInputs.lists = vis.gpuRaster!.lists
    vis.gpuBins!.encode(compute, running.pass, binInputs)
  },
}

/** Whether the image is a see-through view's (`wireframe` or `xray`), which draws every cluster by the
 *  hardware raster too (`./xray.ts`): the software raster's clusters are binned to the hardware slots
 *  as well. */
export const seeThrough = (rt: WebgpuPagesRuntime) =>
  rt.run.diagnostic === 'wireframe' || rt.run.diagnostic === 'xray'

/** Sends the image's options to the bins (`GpuBins.write`), once before its passes. */
export function writeBinOptions(rt: WebgpuPagesRuntime) {
  rt.vis.gpuBins!.write({ softwareSlots: seeThrough(rt) })
}

/**
 * The steps `pass`'s binning runs (`../raster/raster.ts`, `encodeBinning`): its counters cleared, the
 * decode of the clusters the cut listed for it, the deformation of those that move — only where
 * the session deforms —, and the bins. The one object, rewritten here: it names the runtime
 * until the next call.
 */
export function binningSteps(rt: WebgpuPagesRuntime, pass: RasterPass): BinningSteps {
  running.rt = rt
  running.pass = pass
  steps.deform = rt.vis.deformationCompute && rt.vis.deformation?.any ? deformClusters : undefined
  return steps
}
