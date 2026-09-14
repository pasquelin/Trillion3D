import type { GpuHiz } from './gpuHiz.ts';
import type { createWebgpuRowState } from './webgpuRowState.ts';
import type { createWebgpuVisibilityDrawer } from './webgpuVisibilityDrawer.ts';
type Rows = ReturnType<typeof createWebgpuRowState>;
type Drawer = ReturnType<typeof createWebgpuVisibilityDrawer>;
type PassOptions = {
  device: GPUDevice;
  encoder: GPUCommandEncoder;
  idsView: GPUTextureView;
  depthTarget: GPUTextureView;
  width: number;
  height: number;
  gpuHiz?: GpuHiz;
  visDrawer: Drawer;
  twoPass: boolean;
  occluderVertices: number;
  restVertices: number;
  hizTestedBounds: Float64Array;
  hizTestedRows: Uint32Array;
  testedCount: number;
  tableRows: number;
  rows: Rows;
  hizRest: Uint8Array;
  drawnOccluderUrls: Uint8Array;
  urlIndexOfPage: Int32Array;
  occluders: number;
  noOccluderHistory: boolean;
};

/** Encodes primary and tested visibility passes and updates occluder history. */
export function encodeWebgpuVisibilityPasses({
  device,
  encoder,
  idsView,
  depthTarget,
  width,
  height,
  gpuHiz,
  visDrawer,
  twoPass,
  occluderVertices,
  restVertices,
  hizTestedBounds,
  hizTestedRows,
  testedCount,
  tableRows,
  rows,
  hizRest,
  drawnOccluderUrls,
  urlIndexOfPage,
  occluders,
  noOccluderHistory,
}: PassOptions) {
  let historyEmpty = noOccluderHistory;
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
  visDrawer.drawVis(visPass, false);
  visPass.end();
  let vertices = twoPass ? occluderVertices : occluderVertices + restVertices;
  if (twoPass && gpuHiz) {
    gpuHiz.encodePyramid(encoder);
    gpuHiz.encodeTest(device, encoder, hizTestedBounds, hizTestedRows, testedCount, tableRows);
    const restPass = encoder.beginRenderPass({
      label: 'WG visibility secondary',
      colorAttachments: visColors('load'),
      depthStencilAttachment: { view: depthTarget, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    restPass.setViewport(0, 0, width, height, 0, 1);
    visDrawer.drawVis(restPass, true);
    restPass.end();
    vertices += restVertices;
  }
  if (gpuHiz) {
    // The occluders of this image are the first pass of the next one, unless the view or a world moves.
    drawnOccluderUrls.fill(0);
    for (let i = 0; i < rows.packedCount; i++)
      if (!hizRest[i]) drawnOccluderUrls[urlIndexOfPage[rows.packedPageIndex[i]]] = 1;
    historyEmpty = occluders === 0;
  }
  return { vertices, noOccluderHistory: historyEmpty };
}
