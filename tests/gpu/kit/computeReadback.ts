/** What a diagnostic run binds beside its output: a storage buffer holding these bytes, or any
 *  resource as it is (a texture view, a sampler). */
export type ComputeInput = ArrayBufferView<ArrayBuffer> | GPUBindingResource

export interface ComputeReadbackOptions {
  /** Bound in order in group 0, around the output's binding. */
  inputs?: ComputeInput[]
  /** The output's binding: after the inputs unless named. */
  output?: number
  /** How the output's words are read: floats unless `u32` (counters, bits). */
  words?: 'f32' | 'u32'
}

/** Runs a diagnostic compute pipeline whose one storage output is a binding of group 0 — binding
 *  0 when it reads nothing else —, its `inputs` bound around it, and returns that output's words,
 *  f32 or u32, read back once the GPU ran it. */
export async function computeReadback(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  bytes: number,
  workgroups = 1,
  { inputs = [], output: at = inputs.length, words = 'f32' }: ComputeReadbackOptions = {},
) {
  const made: GPUBuffer[] = []
  const buffer = (size: number, usage: number) => {
    const created = device.createBuffer({ size, usage })
    made.push(created)
    return created
  }
  try {
    const output = buffer(bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC)
    const resource = (input: ComputeInput): GPUBindingResource => {
      if (!ArrayBuffer.isView(input)) return input
      const storage = buffer(input.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
      device.queue.writeBuffer(storage, 0, input)
      return { buffer: storage }
    }
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: at, resource: { buffer: output } },
        ...inputs.map((input, n) => ({ binding: n < at ? n : n + 1, resource: resource(input) })),
      ],
    })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(workgroups)
    pass.end()
    device.queue.submit([encoder.finish()])
    const read = await readBuffer(device, output, 0, bytes)
    return Array.from(words === 'u32' ? read : new Float32Array(read.buffer))
  } finally {
    for (const created of made) created.destroy()
  }
}

/** `bytes` of `source` from `offset`, copied once the queue's work before it ran, as words. */
export async function readBuffer(
  device: GPUDevice,
  source: GPUBuffer,
  offset: number,
  bytes: number,
) {
  const target = device.createBuffer({
    size: Math.max(4, bytes),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  try {
    const encoder = device.createCommandEncoder()
    if (bytes) encoder.copyBufferToBuffer(source, offset, target, 0, bytes)
    device.queue.submit([encoder.finish()])
    await target.mapAsync(GPUMapMode.READ)
    return new Uint32Array(target.getMappedRange().slice(0, bytes))
  } finally {
    target.destroy()
  }
}

/** Level 0 of `texture` read back, `bytesPerTexel` a texel — any format —, its rows packed the top
 *  first: WebGPU's copy pads each row to 256 bytes, the padding dropped here. */
export async function readTexture(device: GPUDevice, texture: GPUTexture, bytesPerTexel: number) {
  const { width, height } = texture,
    row = width * bytesPerTexel,
    pitch = Math.ceil(row / 256) * 256
  const target = device.createBuffer({
    size: pitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  try {
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: target, bytesPerRow: pitch, rowsPerImage: height },
      [width, height],
    )
    device.queue.submit([encoder.finish()])
    await target.mapAsync(GPUMapMode.READ)
    const mapped = new Uint8Array(target.getMappedRange()),
      rows = new Uint8Array(row * height)
    for (let y = 0; y < height; y++) rows.set(mapped.subarray(y * pitch, y * pitch + row), y * row)
    return rows
  } finally {
    target.destroy()
  }
}
