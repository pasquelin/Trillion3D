// Oracle for G4 checkpoint: `webgpuPagesMetrics.ts` before batch G. The report re-summed, at each call,
// the size of all resident position buffers and all transparent meshes.
import type { WebgpuGpuState } from '../../webgpuPagesStateGpu.ts';
import type { BlendGpuItem } from '../../webgpuBlendState.ts';

export function referenceVertexBytes(
  gpu: Pick<WebgpuGpuState, 'positionBuffers'>,
  vis: {
    concatPos?: { size: number };
    concatUv?: { size: number };
    concatNrm?: { size: number };
  },
  blendState: { blendGpu: BlendGpuItem[] },
) {
  let vertexBytes = 0;
  for (const buffer of gpu.positionBuffers.values()) vertexBytes += buffer.size;
  vertexBytes +=
    (vis.concatPos?.size ?? 0) + (vis.concatUv?.size ?? 0) + (vis.concatNrm?.size ?? 0);
  for (const item of blendState.blendGpu)
    vertexBytes += (item.index?.size ?? 0) + (item.uv?.size ?? 0) + (item.normal?.size ?? 0);
  return vertexBytes;
}
