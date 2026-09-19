import { viewProj } from './webgpuPagesHelpers.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Le chemin de repli des transparents : celui des appareils ou le tampon de visibilite n'a pas pu
 * etre monte. Il retains le shader generique, son uniforme by primitive et sa selection
 * processeur — il n'est pas le chemin des images de production, et rien n'y a ete optimise.
 */
export function writeFallbackBlendUniforms(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  uniformBase: number,
) {
  const { run, blendState } = rt,
    items = blendState.visibleBlend,
    { uniformPacked } = rt.gpu,
    uniformBuffer = rt.gpu.uniformBuffer!;
  const words = UNIFORM_STRIDE / 4;
  const packedInts = new Uint32Array(
    uniformPacked.buffer,
    uniformPacked.byteOffset,
    uniformPacked.length,
  );
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      base = (uniformBase + i) * words;
    uniformPacked.set(viewProj, base);
    uniformPacked.set(item.matrix.elements, base + 16);
    uniformPacked[base + 32] = item.rgba[0];
    uniformPacked[base + 33] = item.rgba[1];
    uniformPacked[base + 34] = item.rgba[2];
    uniformPacked[base + 35] = item.rgba[3];
    packedInts[base + 36] = item.tableBase ?? 0;
    packedInts[base + 37] = item.count;
    packedInts[base + 38] = run.diagnostic === 'wireframe' ? 1 : 0;
    packedInts[base + 39] = item.flags;
  }
  device.queue.writeBuffer(
    uniformBuffer,
    uniformBase * UNIFORM_STRIDE,
    uniformPacked.subarray(uniformBase * words, (uniformBase + items.length) * words),
  );
}

/** Encode la passe de repli : un groupe de liaison et un decalage dynamique by primitive. */
export function drawFallbackBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  uniformBase: number,
) {
  const { gpu, run, blendState } = rt,
    items = blendState.visibleBlend,
    indirect = blendState.compaction?.indirectBuffer;
  let unpaged = 0;
  const pass = encoder.beginRenderPass({
    label: 'WG transparents',
    colorAttachments: [{ view: gpu.colorView!, loadOp: 'load', storeOp: 'store' }],
    depthStencilAttachment: { view: gpu.depthView!, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1);
  pass.setPipeline(gpu.pipelineBlend!);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.group ??= device.createBindGroup({
      layout: gpu.bindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: item.index ?? gpu.cache!.buffer } },
        { binding: 1, resource: { buffer: item.position } },
        { binding: 2, resource: { buffer: gpu.uniformBuffer!, size: UNIFORM_STRIDE } },
      ],
    });
    pass.setBindGroup(0, item.group, [(uniformBase + i) * UNIFORM_STRIDE]);
    if (item.paged && indirect && item.pagedIndex !== undefined)
      pass.drawIndirect(indirect, item.pagedIndex * 16);
    else {
      pass.draw(item.count);
      unpaged += item.count / 3;
    }
  }
  pass.end();
  run.gpuDrawCalls += items.length;
  run.blendDrawCalls += items.length;
  run.blendUnpagedTriangles += unpaged;
  run.blendSubmittedTriangles = run.blendPagedTriangles + run.blendUnpagedTriangles;
}
