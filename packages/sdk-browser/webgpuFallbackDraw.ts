import type { DiagnosticMode } from '../sdk-core/index.ts';
import { viewProj } from './webgpuPagesHelpers.ts';
import { clearValueOf } from './webgpuPagesEncoder.ts';
import { PAGE_INFO_STRIDE, clusterHash } from './visibilityBuffer.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import type { PageRec } from './pageSelection.ts';
import type { createWebgpuRowState } from './webgpuRowState.ts';
type Rows = ReturnType<typeof createWebgpuRowState>;
type FallbackOptions = {
  device: GPUDevice;
  rows: Rows;
  uniformPacked: Float32Array<ArrayBuffer>;
  uniformBuffer?: GPUBuffer;
  diagnostic: DiagnosticMode;
  pageRgb: (rec: PageRec) => [number, number, number];
  createRenderEncoder: (device: GPUDevice) => GPUCommandEncoder;
  colorView: GPUTextureView;
  depthView: GPUTextureView;
  width: number;
  height: number;
  clearColor: number;
  bindGroupFor: (device: GPUDevice, position: GPUBuffer) => GPUBindGroup | undefined;
  pipelineFor: (rec: PageRec) => GPURenderPipeline | undefined;
};

/** Uploads and draws opaque rows through the non-visibility fallback pipeline. */
export function drawWebgpuFallback({
  device,
  rows,
  uniformPacked,
  uniformBuffer,
  diagnostic,
  pageRgb,
  createRenderEncoder,
  colorView,
  depthView,
  width,
  height,
  clearColor,
  bindGroupFor,
  pipelineFor,
}: FallbackOptions) {
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
      color = pageRgb(rec);
    uniformPacked.set(viewProj.elements, base);
    uniformPacked.set(rec.matrix.elements, base + 16);
    uniformPacked[base + 32] = color[0];
    uniformPacked[base + 33] = color[1];
    uniformPacked[base + 34] = color[2];
    uniformPacked[base + 35] = 1;
    packedInts[base + 36] = rows.pageTableInts![row * fallbackWords + 24];
    packedInts[base + 37] = rows.pageTableInts![row * fallbackWords + 25];
    packedInts[base + 38] = diagnostic === 'wireframe' ? 1 : 0;
    packedInts[base + 39] = clusterHash(rec.clusterId);
  }
  if (rows.packedCount && uniformBuffer)
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      uniformPacked.subarray(0, rows.packedCount * (UNIFORM_STRIDE / 4)),
    );
  const encoder = createRenderEncoder(device);
  const pass = encoder.beginRenderPass({
    label: 'WG opaque fallback',
    colorAttachments: [
      {
        view: colorView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: clearValueOf(clearColor),
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  pass.setViewport(0, 0, width, height, 0, 1);
  let vertices = 0,
    drawCalls = 0;
  for (let i = 0; i < rows.packedCount; i++) {
    const position = rows.packedPositions[i];
    if (!position) continue;
    const group = bindGroupFor(device, position),
      pipeline = pipelineFor(rows.packedRecs[i]!);
    if (!group || !pipeline) continue;
    const count = rows.pageTableInts![i * fallbackWords + 25];
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group, [i * UNIFORM_STRIDE]);
    pass.draw(count);
    drawCalls++;
    vertices += count;
  }
  pass.end();
  return { encoder, vertices, drawCalls };
}
