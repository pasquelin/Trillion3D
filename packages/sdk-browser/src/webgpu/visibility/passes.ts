import { drawVis } from './drawer.ts'
import { skipsSecondaryPass } from '../../diagnostic/gpuGeometry.ts'
import { restSlotCount } from '../../gpu/draw/contract.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { ComputeRasterStages } from '../pages/render/encodeVisSetup.ts'
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
import { HIZ_PASS } from '../../stage/passLabels.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'

/** The occlusion step's compute pass, opened by the first of its kernels that dispatches. */
const hizPass = new LazyComputePass(HIZ_PASS)

/**
 * The Hi-Z pyramid, its occlusion test and the recompaction it allows: what splits the occluder
 * half from the tested half, whoever produced the image.
 *
 * None of these decisions depends on a count the CPU would have established row by row: the
 * occlusion kernel itself reads how many boxes the partition compacted for it. An image whose GPU
 * put everything on the occluder side therefore still encodes this step, which culls nothing —
 * and the image is the same.
 *
 * The verdict it writes has three values and that is what the compute raster reads: `0` for a row
 * of the occluder half, `1` for a tested row the pyramid rejects, `2` for a tested row it keeps.
 * The partition set the `0`s and the `2`s before this step; the test only brings some `2`s down
 * to `1`. True when the rejected rows left the tested half (`GpuRestCompact.encode`).
 *
 * One compute pass for the three: its dispatches run in order and each sees what the previous
 * wrote — the test reads the pyramid, the compaction the verdicts.
 */
function encodeHizMidFrame(rt: WebgpuPagesRuntime, device: GPUDevice, encoder: GPUCommandEncoder) {
  const { vis } = rt,
    { rows } = rt.layout,
    { gpuHiz } = vis
  if (!gpuHiz) return false
  const pass = hizPass.begin(encoder)
  gpuHiz.encodePyramid(pass)
  rt.run.hizPyramidFresh = true
  // The test reads each row's Hi-Z slot in the page table: without one, no row was drawn.
  // Its rejects are counted on the partition's counting frame, into the partition's counters.
  const counting = !!vis.gpuPartition?.counting
  if (vis.pageTable) gpuHiz.encodeTest(device, pass, rows.packedCount, vis.pageTable, counting)
  // The verdict exists now: the rejected rows leave the tested half, the survivors keeping their
  // order, before the second pass launches their vertices. They placed no pixel: the image does
  // not move.
  const compacted =
    !!vis.gpuRestCompact &&
    !!vis.pageTable &&
    !!vis.gpuDraw &&
    vis.gpuRestCompact.encode(
      pass,
      restSlotCount(vis.drawLayerSlots),
      // A slot lists a row's batches, up to `perRow` instances each: every one is read.
      rows.packedCount * vis.gpuDraw.perRow,
      vis.pageTable,
    )
  pass.end()
  return compacted
}

/**
 * The visibility buffer, in this order: the primary hardware pass and the impostor
 * cards, the occluder half of the compute raster blended into it, the pyramid and its test, the secondary pass, the tested
 * half of compute, then its identifiers. Without `compute` — no compute raster — hardware alone
 * produces the same attachments, and each compute step is simply absent.
 */
export function encodeWebgpuVisibilityPasses(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  twoPass: boolean,
  useIndirect: boolean,
  compute: ComputeRasterStages,
) {
  const { vis, gpu } = rt,
    { gpuHiz } = vis,
    idsView = vis.visView!,
    depthTarget = gpu.depthView!,
    [width, height] = gpu.targetSize
  const visColors = (loadOp: 'clear' | 'load') => {
    const ids: {
      view: GPUTextureView
      loadOp: 'clear' | 'load'
      storeOp: 'store'
      clearValue?: GPUColor
    } = { view: idsView, loadOp, storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }
    if (!gpuHiz) return [ids]
    return [
      ids,
      {
        // Level 0 of the pyramid is a DEPTH: its clear is the far plane, not 1. In reversed Z,
        // clearing it to 1 filled every uncovered texel with the near plane, and the min reduction
        // then yielded 1 over a whole background block — enough to reject any page that projects
        // there. Those are the holes a campaign used to see by the thousands of pixels.
        view: gpuHiz.level0View,
        loadOp,
        storeOp: 'store' as const,
        clearValue: { r: DEPTH_CLEAR, g: 0, b: 0, a: 1 },
      },
    ]
  }
  const visPass = encoder.beginRenderPass({
    label: 'Trillion3D visibility primary',
    colorAttachments: visColors('clear'),
    depthStencilAttachment: {
      view: depthTarget,
      depthClearValue: DEPTH_CLEAR,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  })
  visPass.setViewport(0, 0, width, height, 0, 1)
  drawVis(rt, device, visPass, false, useIndirect)
  // The impostor cards occlude as their meshes would: in the depth and the pyramid built next.
  rt.gpu.impostorCode?.drawImpostorVisibility(rt, device, visPass, !!gpuHiz)
  visPass.end()
  compute?.occluders(encoder)
  rt.run.hizPyramidFresh = false
  const tested = twoPass && !!gpuHiz
  const compacted = tested && encodeHizMidFrame(rt, device, encoder)
  // The only diagnostic variant that touches encoded commands: it leaves the tested half out of
  // the image to weigh the occluders alone, and therefore yields an incomplete image.
  if (tested && !skipsSecondaryPass(rt.context?.diagnosticGpuVariant)) {
    const restPass = encoder.beginRenderPass({
      label: 'Trillion3D visibility secondary',
      colorAttachments: visColors('load'),
      depthStencilAttachment: { view: depthTarget, depthLoadOp: 'load', depthStoreOp: 'store' },
    })
    restPass.setViewport(0, 0, width, height, 0, 1)
    drawVis(rt, device, restPass, true, useIndirect, compacted)
    restPass.end()
    compute?.rest(encoder)
  }
  compute?.ids(encoder)
}
