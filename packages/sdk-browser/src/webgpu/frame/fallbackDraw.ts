import { viewProj } from '../pages/helpers.ts';
import { createRenderEncoder } from '../pages/render/encoder.ts';
import { clearValueOf } from '../../../../sdk-core/src/world/math/packedColour.ts';
import { PAGE_INFO_STRIDE, clusterHash } from '../../visibility/buffer.ts';
import { UNIFORM_STRIDE } from '../blend/uniforms.ts';
import { ROW_INDEX_WORDS } from '../row/pageRow.ts';
import { FALLBACK_CLUSTER_PAGE, FALLBACK_WIREFRAME } from '../pages/prepare/shaders.ts';
import {
  bindGroupFor,
  pageRgb,
  pipelineFor,
  voidStaleFallbackGroups,
} from '../pages/prepare/pipelineFor.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts';

/** Uploads and draws opaque rows through the non-visibility fallback pipeline; the draws count on
 *  `rt.run.gpuDrawCalls` and the open encoder comes back with the vertices drawn. */
export function drawWebgpuFallback(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, run } = rt,
    { rows } = rt.layout,
    { uniformPacked, uniformBuffer } = gpu,
    [width, height] = gpu.targetSize;
  const packedInts = new Uint32Array(
    uniformPacked.buffer,
    uniformPacked.byteOffset,
    uniformPacked.length,
  );
  const fallbackWords = PAGE_INFO_STRIDE / 4;
  for (let i = 0; i < rows.packedCount; i++) {
    const rec = rows.packedRecs[i]!,
      row = i,
      base = i * (UNIFORM_STRIDE / 4),
      color = pageRgb(rt, rec);
    uniformPacked.set(viewProj, base);
    uniformPacked.set(rec.matrix.elements, base + 16);
    uniformPacked[base + 32] = color[0];
    uniformPacked[base + 33] = color[1];
    uniformPacked[base + 34] = color[2];
    uniformPacked[base + 35] = 1;
    packedInts[base + 36] = rows.pageTableInts![row * fallbackWords + 24];
    packedInts[base + 37] = rows.pageTableInts![row * fallbackWords + ROW_INDEX_WORDS];
    packedInts[base + 38] =
      (run.diagnostic === 'wireframe' ? FALLBACK_WIREFRAME : 0) |
      (rec.geometryPage ? FALLBACK_CLUSTER_PAGE : 0);
    packedInts[base + 39] = clusterHash(rec.clusterId);
  }
  if (rows.packedCount && uniformBuffer)
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      uniformPacked.subarray(0, rows.packedCount * (UNIFORM_STRIDE / 4)),
    );
  const encoder = createRenderEncoder(rt, device);
  const pass = encoder.beginRenderPass({
    label: 'WG opaque fallback',
    colorAttachments: [
      {
        view: gpu.colorView!,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: clearValueOf(rt.setup.clearColor),
      },
    ],
    depthStencilAttachment: {
      view: gpu.depthView!,
      depthClearValue: DEPTH_CLEAR,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  pass.setViewport(0, 0, width, height, 0, 1);
  voidStaleFallbackGroups(rt);
  let vertices = 0;
  for (let i = 0; i < rows.packedCount; i++) {
    const rec = rows.packedRecs[i]!;
    // A cluster drawn from its quantized page reads no float position, but the binding still needs
    // a buffer: the smallest one the engine holds stands in, and the shader never reads it. Any
    // other cluster without its positions is skipped, as before.
    const position = rec.geometryPage ? gpu.zeroUv : rows.packedPositions[i];
    if (!position) continue;
    const group = bindGroupFor(rt, device, position),
      pipeline = pipelineFor(rt, rec);
    if (!group || !pipeline) continue;
    const count = rows.pageTableInts![i * fallbackWords + ROW_INDEX_WORDS];
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group, [i * UNIFORM_STRIDE]);
    pass.draw(count);
    run.gpuDrawCalls++;
    vertices += count;
  }
  pass.end();
  return { encoder, vertices };
}
