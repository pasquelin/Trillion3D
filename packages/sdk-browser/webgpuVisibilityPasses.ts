import { drawVis } from './webgpuVisibilityDrawer.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Encodes primary and tested visibility passes, updates the occluder history on `rt.run` and
 *  returns the vertices the passes drew. */
export function encodeWebgpuVisibilityPasses(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  partition: { occluders: number; twoPass: boolean; restDigest: number },
  items: { occluderVertices: number; restVertices: number; testedCount: number },
  tableRows: number,
  useIndirect: boolean,
) {
  const { vis, gpu, run } = rt,
    {
      rows,
      hizRest,
      hizTestedBounds,
      hizTestedRows,
      hizCountSample,
      drawnOccluderUrls,
      urlIndexOfPage,
    } = rt.layout,
    { gpuHiz } = vis,
    idsView = vis.visView!,
    depthTarget = gpu.depthView!,
    [width, height] = gpu.targetSize,
    { occluders, twoPass, restDigest } = partition,
    { occluderVertices, restVertices, testedCount } = items;
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
        view: gpuHiz.level0View,
        loadOp,
        storeOp: 'store' as const,
        clearValue: { r: 1, g: 0, b: 0, a: 1 },
      },
    ];
  };
  const visPass = encoder.beginRenderPass({
    label: 'WG visibility primary',
    colorAttachments: visColors('clear'),
    depthStencilAttachment: {
      view: depthTarget,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  visPass.setViewport(0, 0, width, height, 0, 1);
  drawVis(rt, device, visPass, false, twoPass, useIndirect);
  visPass.end();
  let vertices = twoPass ? occluderVertices : occluderVertices + restVertices;
  if (twoPass && gpuHiz) {
    gpuHiz.encodePyramid(encoder);
    // The verdicts this image copies back are the verdicts of this image.
    hizCountSample.frame = run.frame;
    gpuHiz.encodeTest(
      device,
      encoder,
      hizTestedBounds,
      hizTestedRows,
      testedCount,
      tableRows,
      hizCountSample,
    );
    const restPass = encoder.beginRenderPass({
      label: 'WG visibility secondary',
      colorAttachments: visColors('load'),
      depthStencilAttachment: { view: depthTarget, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    restPass.setViewport(0, 0, width, height, 0, 1);
    drawVis(rt, device, restPass, true, twoPass, useIndirect);
    restPass.end();
    vertices += restVertices;
  }
  if (gpuHiz) {
    // The occluders of this image are the first pass of the next one, unless the view or a world moves.
    drawnOccluderUrls.fill(0);
    for (let i = 0; i < rows.packedCount; i++)
      if (!hizRest[i]) drawnOccluderUrls[urlIndexOfPage[rows.packedPageIndex[i]]] = 1;
    // La moitié testée, hachée dans l'ordre des lignes : deux images qui partagent cette signature
    // partagent l'historique d'occulteurs que la suivante hérite. C'est le condensé que la partition
    // de cette image-ci a déjà rendu — `hizRest` n'est écrit que là —, pas un second parcours.
    run.occluderSignature = restDigest;
    run.noOccluderHistory = occluders === 0;
  }
  return vertices;
}
