/**
 * The colour bytes per sample the attachments `formats` take, as WebGPU checks them against
 * `maxColorAttachmentBytesPerSample`: each cost aligned to its own alignment, summed in order.
 * A format missing from the table throws, so a new target cannot be counted as free.
 */
export function colorBytesPerSample(formats: readonly (GPUTextureFormat | undefined)[]) {
  let total = 0
  for (const format of formats) {
    if (!format) continue
    const entry = COLOR_TARGET_COST[format]
    if (!entry) throw new Error(`no colour byte cost for ${format}`)
    const [cost, alignment] = entry
    total = Math.ceil(total / alignment) * alignment + cost
  }
  return total
}

/**
 * WebGPU's render target pixel byte cost and alignment of each colour format the engine draws
 * into (the spec's texture format capabilities table). An 8-bit four-channel format costs 8, not 4.
 */
const COLOR_TARGET_COST: Partial<Record<GPUTextureFormat, [cost: number, alignment: number]>> = {
  r8unorm: [1, 1],
  r8uint: [1, 1],
  rg8unorm: [2, 1],
  rgba8unorm: [8, 1],
  bgra8unorm: [8, 1],
  r32uint: [4, 4],
  r32float: [4, 4],
  rg32uint: [8, 4],
  rgba16float: [8, 2],
  // The lobes target, which the water's lobed surface stage writes (`../../webgpu/water/`).
  rgba32uint: [16, 4],
}
