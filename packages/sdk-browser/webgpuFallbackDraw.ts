import { viewProj } from './webgpuPagesHelpers.ts';
import { clearValueOf, createRenderEncoder } from './webgpuPagesEncoder.ts';
import { PAGE_INFO_STRIDE, clusterHash } from './visibilityBuffer.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import { ROW_INDEX_WORDS } from './webgpuPageRow.ts';
import { bindGroupFor, pageRgb, pipelineFor } from './webgpuPagesPipelineFor.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

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
    uniformPacked.set(viewProj.elements, base);
    uniformPacked.set(rec.matrix.elements, base + 16);
    uniformPacked[base + 32] = color[0];
    uniformPacked[base + 33] = color[1];
    uniformPacked[base + 34] = color[2];
    uniformPacked[base + 35] = 1;
    packedInts[base + 36] = rows.pageTableInts![row * fallbackWords + 24];
    packedInts[base + 37] = rows.pageTableInts![row * fallbackWords + ROW_INDEX_WORDS];
    packedInts[base + 38] = run.diagnostic === 'wireframe' ? 1 : 0;
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
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  pass.setViewport(0, 0, width, height, 0, 1);
  let vertices = 0;
  for (let i = 0; i < rows.packedCount; i++) {
    const position = rows.packedPositions[i];
    if (!position) continue;
    const group = bindGroupFor(rt, device, position),
      pipeline = pipelineFor(rt, rows.packedRecs[i]!);
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
