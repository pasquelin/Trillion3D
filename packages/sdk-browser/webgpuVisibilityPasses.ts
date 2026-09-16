import { drawVis } from './webgpuVisibilityDrawer.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Encode la passe de visibilité primaire puis, quand les ressources de la moitié testée existent, la
 * pyramide, le test d'occultation et la passe secondaire.
 *
 * Aucune de ces trois décisions ne dépend plus d'un compte que le processeur aurait établi ligne par
 * ligne : les commandes indirectes disent combien d'instances chaque moitié dessine, et le noyau
 * d'occultation lit lui-même le nombre de boîtes que la partition lui a compactées. Une image dont
 * la carte a tout mis du côté des occulteurs encode donc quand même sa seconde passe, qui dessine
 * zéro instance — et l'image est la même.
 */
export function encodeWebgpuVisibilityPasses(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  twoPass: boolean,
  tableRows: number,
  useIndirect: boolean,
) {
  const { vis, gpu } = rt,
    { rows } = rt.layout,
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
  drawVis(rt, device, visPass, false, useIndirect);
  visPass.end();
  rt.run.hizPyramidFresh = false;
  if (!twoPass || !gpuHiz) return;
  gpuHiz.encodePyramid(encoder);
  rt.run.hizPyramidFresh = true;
  gpuHiz.encodeTest(device, encoder, rows.packedCount, tableRows);
  const restPass = encoder.beginRenderPass({
    label: 'WG visibility secondary',
    colorAttachments: visColors('load'),
    depthStencilAttachment: { view: depthTarget, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  restPass.setViewport(0, 0, width, height, 0, 1);
  drawVis(rt, device, restPass, true, useIndirect);
  restPass.end();
}
