import { viewProj } from '../pages/helpers.ts';
import { createRenderEncoder } from '../pages/render/encoder.ts';
import { clearValueOf } from '../../../../sdk-core/src/world/math/packedColour.ts';
import { PAGE_INFO_STRIDE, clusterHash } from '../../visibility/buffer.ts';
import { UNIFORM_STRIDE, writeFallbackUniform } from '../blend/uniforms.ts';
import {
  ROW_DASH_WORD,
  ROW_INDEX_WORDS,
  ROW_LINE_WIDTH_WORD,
  ROW_SPRITE_WORD,
} from '../row/pageRow.ts';
import { fallbackMode } from '../pages/prepare/shaders.ts';
import {
  bindGroupFor,
  pageRgb,
  pipelineFor,
  voidStaleFallbackGroups,
} from '../pages/prepare/pipelineFor.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts';
import { rootOf } from '../../page/selection/placements.ts';

/** Uploads and draws opaque rows through the non-visibility fallback pipeline; the draws count on
 *  `rt.run.gpuDrawCalls` and the open encoder comes back with the vertices drawn. */
export function drawWebgpuFallback(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, run } = rt,
    { rows } = rt.layout,
    { uniformPacked, uniformBuffer } = gpu,
    [width, height] = gpu.targetSize,
    pixelRatio = rt.setup.pixelRatio();
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
    writeFallbackUniform(uniformPacked, packedInts, base, {
      projection: viewProj,
      world: rootOf(rt.layout.selectionRoots, rec).world.elements,
      color,
      opacity: 1,
      pageOffset: rows.pageTableInts![row * fallbackWords + 24],
      indexCount: rows.pageTableInts![row * fallbackWords + ROW_INDEX_WORDS],
      mode: fallbackMode(run.diagnostic, !!rec.geometryPage),
      identity: clusterHash(rec.clusterId),
      lineWidth: rows.pageTableFloats![row * fallbackWords + ROW_LINE_WIDTH_WORD],
      pixelRatio,
      width,
      height,
      dash: rows.pageTableFloats![row * fallbackWords + ROW_DASH_WORD],
      gap: rows.pageTableFloats![row * fallbackWords + ROW_DASH_WORD + 1],
      spriteRotation: rows.pageTableFloats![row * fallbackWords + ROW_SPRITE_WORD],
      spriteMode: rows.pageTableFloats![row * fallbackWords + ROW_SPRITE_WORD + 1],
    });
  }
  if (rows.packedCount && uniformBuffer)
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      uniformPacked.subarray(0, rows.packedCount * (UNIFORM_STRIDE / 4)),
    );
  const encoder = createRenderEncoder(rt, device);
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D opaque fallback',
    colorAttachments: [
      {
        view: gpu.colorView!,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: clearValueOf(rt.run.clearColor),
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
