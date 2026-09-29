type Args = {
  shader: string;
  bindings: GPUBindGroupLayoutEntry[];
  pool: number[];
  positions: number[];
  row: number[];
  output: number;
  dynamic: number;
  wave: number[];
  whole: number[];
};
export async function probe(args: Args) {
  const gpu = await globalThis.ouvrirAppareil();
  if (!gpu) return { unavailable: 'WebGPU unavailable' };
  const compiled = await gpu.compile(args.shader);
  if (compiled.compilation.length) return { errors: compiled.compilation };
  const device = gpu.device;
  const bindLayout = device.createBindGroupLayout({ entries: args.bindings });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
    compute: { module: compiled.module, entryPoint: 'deform' },
  });
  const data = [
    args.pool,
    args.positions,
    [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
    args.row,
    [0],
    [1, 0, 0, 0],
  ];
  const buffers = data.map((values, binding) => {
    const buffer = device.createBuffer({
      size: values.length * 4,
      usage:
        (binding === 5 ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE) |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(buffer, 0, new Uint32Array(values));
    return buffer;
  });
  const group = device.createBindGroup({
    layout: bindLayout,
    entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const read = device.createBuffer({
    size: 3 * 11 * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const images: number[][] = [];
  for (let frame = 1; frame <= 7; frame++) {
    if (frame === 2) {
      const dynamicRow = new Uint32Array(args.row);
      dynamicRow[23] = args.dynamic;
      dynamicRow[58] = 0;
      dynamicRow[47] = 1;
      device.queue.writeBuffer(buffers[3], 0, dynamicRow);
      device.queue.writeBuffer(buffers[1], 0, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    }
    if (frame === 3)
      device.queue.writeBuffer(buffers[1], 0, new Float32Array([0, 0, 2, 1, 0, 2, 0, 1, 2]));
    if (frame === 5) {
      device.queue.writeBuffer(buffers[3], 0, new Uint32Array(args.row));
      device.queue.writeBuffer(
        buffers[0],
        (args.row[24] + 4) * 4,
        new Uint32Array([args.pool[args.row[24] + 4] | 64]),
      );
      const soft = new Float32Array(160),
        bits = new Uint32Array(soft.buffer);
      bits.set([8, 8, 0, 0, 0, 1, 1, 0]);
      soft.set([0, 0, 3, 0, 0, 2, 0, 0, 0, 0, 0, 1], 8);
      device.queue.writeBuffer(buffers[1], 0, soft);
    }
    if (frame === 6) {
      const wave = new Float32Array(160),
        bits = new Uint32Array(wave.buffer);
      bits.set([4, 4, 0, 0, 1, 0, 0, 0]);
      const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      wave.set(identity, 8);
      wave.set(identity, 24);
      wave.set(args.wave, 40);
      device.queue.writeBuffer(buffers[1], 0, wave);
    }
    if (frame === 7) {
      const row = new Uint32Array(args.row);
      row[23] = 0;
      row[26] = 0;
      row[27] = 53;
      row[58] = 17;
      row[59] = 0x80000065;
      device.queue.writeBuffer(buffers[3], 0, row);
      device.queue.writeBuffer(buffers[1], 0, new Uint32Array(args.whole));
    }
    device.queue.writeBuffer(buffers[5], 0, new Uint32Array([frame, 0, 0, 0]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(
      buffers[frame === 7 ? 1 : 0],
      (frame === 7 ? 100 : args.output) * 4,
      read,
      0,
      3 * 11 * 4,
    );
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    images.push([...new Float32Array(read.getMappedRange())]);
    read.unmap();
  }
  const adapter = await gpu.fermer();
  return { images, errors: gpu.erreurs, adapter: adapter.court };
}
