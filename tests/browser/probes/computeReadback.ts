/** Execute a diagnostic compute pipeline with one storage output and return its f32 words.
 * Self-contained so pageWebgpu can install it in the isolated browser realm. */
export async function computeReadback(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  bytes: number,
  workgroups = 1,
) {
  const output = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  let readback: GPUBuffer | undefined;
  try {
    readback = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: output } }],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const values = Array.from(new Float32Array(readback.getMappedRange()));
    readback.unmap();
    return values;
  } finally {
    readback?.destroy();
    output.destroy();
  }
}
