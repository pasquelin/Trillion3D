/** Consecutive dispatches in one pass build the whole pyramid without extra submissions. */
export function encodeHizPyramid(
  encoder: GPUCommandEncoder,
  width: number,
  height: number,
  bindGroup: GPUBindGroup,
  copyPipeline: GPUComputePipeline,
  reducePipeline: GPUComputePipeline,
  sizes: Array<[number, number]>,
  maxLevels: number,
  uniformBytes: number,
  workgroup: number,
) {
  const pass = encoder.beginComputePass({ label: 'Trillion3D HiZ pyramid' });
  pass.setPipeline(copyPipeline);
  pass.setBindGroup(0, bindGroup, [0]);
  pass.dispatchWorkgroups(
    Math.max(1, Math.ceil(width / workgroup)),
    Math.max(1, Math.ceil(height / workgroup)),
  );
  pass.setPipeline(reducePipeline);
  for (let i = 0; i < sizes.length - 1 && i + 1 < maxLevels; i++) {
    const [dstW, dstH] = sizes[i + 1];
    pass.setBindGroup(0, bindGroup, [(i + 1) * uniformBytes]);
    pass.dispatchWorkgroups(
      Math.max(1, Math.ceil(dstW / workgroup)),
      Math.max(1, Math.ceil(dstH / workgroup)),
    );
  }
  pass.end();
}
