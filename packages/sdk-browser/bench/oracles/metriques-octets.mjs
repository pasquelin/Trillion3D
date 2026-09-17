// Oracle du point G4 : `webgpuPagesMetrics.ts` avant le lot G. Le relevé resommait, à chaque appel,
// la taille de tous les tampons de positions résidents et de tous les maillages transparents.
export function referenceVertexBytes(gpu, vis, blendState) {
  let vertexBytes = 0;
  for (const buffer of gpu.positionBuffers.values()) vertexBytes += buffer.size;
  vertexBytes +=
    (vis.concatPos?.size ?? 0) + (vis.concatUv?.size ?? 0) + (vis.concatNrm?.size ?? 0);
  for (const item of blendState.blendGpu)
    vertexBytes += (item.index?.size ?? 0) + (item.uv?.size ?? 0) + (item.normal?.size ?? 0);
  return vertexBytes;
}
