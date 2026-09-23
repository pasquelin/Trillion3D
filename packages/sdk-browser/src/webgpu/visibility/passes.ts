import { drawVis } from './drawer.ts';
import { skipsSecondaryPass } from '../../diagnostic/gpuGeometry.ts';
import { restSlotCount } from '../../gpu/draw/contract.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { ComputeRasterStages } from '../pages/render/encodeVisSetup.ts';
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts';

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
 * to `1`.
 */
function encodeHizMidFrame(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  tableRows: number,
) {
  const { vis } = rt,
    { rows } = rt.layout,
    { gpuHiz } = vis;
  if (!gpuHiz) return;
  gpuHiz.encodePyramid(encoder);
  rt.run.hizPyramidFresh = true;
  gpuHiz.encodeTest(device, encoder, rows.packedCount, tableRows);
  // The verdict exists now: the suffix of rejected rows leaves the instance count before the
  // second pass launches their vertices. It was placing no pixel there, the image does not move.
  if (vis.gpuRestCompact && vis.pageTable)
    vis.gpuRestCompact.encode(
      encoder,
      restSlotCount(vis.drawLayerSlots),
      rows.packedCount,
      vis.pageTable,
    );
}

/**
 * The visibility buffer, in the reference's order: the primary hardware pass, the occluder half of
 * the compute raster blended into it, the pyramid and its test, the secondary pass, the tested
 * half of compute, then its identifiers. Without `compute` — no compute raster — hardware alone
 * produces the same attachments, and each compute step is simply absent.
 */
export function encodeWebgpuVisibilityPasses(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  twoPass: boolean,
  tableRows: number,
  useIndirect: boolean,
  compute: ComputeRasterStages,
) {
  const { vis, gpu } = rt,
    { gpuHiz } = vis,
    idsView = vis.visView!,
    depthTarget = gpu.depthView!,
    [width, height] = gpu.targetSize;
  const visColors = (loadOp: 'clear' | 'load') => {
    const ids: {
      view: GPUTextureView;
      loadOp: 'clear' | 'load';
      storeOp: 'store';
      clearValue?: GPUColor;
    } = { view: idsView, loadOp, storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } };
    if (!gpuHiz) return [ids];
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
    ];
  };
  const visPass = encoder.beginRenderPass({
    label: 'WG visibility primary',
    colorAttachments: visColors('clear'),
    depthStencilAttachment: {
      view: depthTarget,
      depthClearValue: DEPTH_CLEAR,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  visPass.setViewport(0, 0, width, height, 0, 1);
  drawVis(rt, device, visPass, false, useIndirect);
  visPass.end();
  compute?.occluders(encoder);
  rt.run.hizPyramidFresh = false;
  const tested = twoPass && !!gpuHiz;
  if (tested) encodeHizMidFrame(rt, device, encoder, tableRows);
  // The only diagnostic variant that touches encoded commands: it leaves the tested half out of
  // the image to weigh the occluders alone, and therefore yields an incomplete image.
  if (tested && !skipsSecondaryPass(rt.context?.diagnosticGpuVariant)) {
    const restPass = encoder.beginRenderPass({
      label: 'WG visibility secondary',
      colorAttachments: visColors('load'),
      depthStencilAttachment: { view: depthTarget, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    restPass.setViewport(0, 0, width, height, 0, 1);
    drawVis(rt, device, restPass, true, useIndirect);
    restPass.end();
    compute?.rest(encoder);
  }
  compute?.ids(encoder);
}
