// The resources and the one timed pass of each peak micro-benchmark (`plan.ts`, `wgsl.ts`), on a
// device of its own: what a run reads filled with noise, the pass encoded with its two timestamps.
import type { PeakBench } from './plan.ts'
import { peakWgsl } from './wgsl.ts'

type Timestamps = GPUComputePassTimestampWrites
/** A benchmark made ready: `encode` adds its timed pass to an encoder, `destroy` frees it. */
export type PreparedPeak = {
  encode: (encoder: GPUCommandEncoder, timestamps: Timestamps) => void
  destroy: () => void
}

const workgroups = (threads: number, size = 256) => Math.ceil(threads / size)

/** `bytes` of noise: a seeded 32-bit sequence, so no compression shrinks what a run reads. */
function noise(bytes: number) {
  const words = new Uint32Array(bytes / 4)
  let state = 1
  for (let i = 0; i < words.length; i++)
    words[i] = state = (Math.imul(state, 1664525) + 1013904223) >>> 0
  return words
}

/** An rgba16float texture of `width` × `height` filled with noise. */
function noiseTexture(device: GPUDevice, width: number, height: number, usage: number) {
  const made = device.createTexture({
    size: [width, height],
    format: 'rgba16float',
    usage: usage | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture: made },
    noise(width * height * 8),
    { bytesPerRow: width * 8 },
    [width, height],
  )
  return made
}

/** The texture a texel benchmark reads, and its view. */
function texture(device: GPUDevice, side: number, held: { destroy(): void }[]) {
  const made = noiseTexture(device, side, side, GPUTextureUsage.TEXTURE_BINDING)
  held.push(made)
  return made.createView()
}

/** The bindings of a compute benchmark, by binding number. */
function computeBindings(device: GPUDevice, bench: PeakBench, held: { destroy(): void }[]) {
  /** A storage buffer, `filled` with noise when a run reads it. */
  const buffer = (size: number, filled = false) => {
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    const made = device.createBuffer({ size, usage })
    if (filled) device.queue.writeBuffer(made, 0, noise(size))
    held.push(made)
    return { buffer: made }
  }
  const small = () => buffer(64)
  const { resource, size } = bench
  if (resource === 'read')
    return { 0: buffer(size.bytes, true), 1: buffer(size.bytes / size.perThread) }
  if (resource === 'write') return { 1: buffer(size.bytes) }
  if (resource === 'copy') return { 0: buffer(size.bytes, true), 1: buffer(size.bytes) }
  if (resource === 'textureStream') return { 0: texture(device, size.side, held), 1: small() }
  if (resource === 'texelLoad' || resource === 'texelFilter') {
    const bindings: Record<number, GPUBindingResource> = {
      0: texture(device, size.side, held),
      1: small(),
    }
    if (resource === 'texelFilter')
      bindings[2] = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    return bindings
  }
  const fixed = resource === 'computePass' || resource === 'dependentDispatch'
  return { 0: buffer(fixed ? 64 : size.threads * 16) }
}

/** The dispatch of a compute benchmark: workgroups in x and y. */
function dispatchOf({ resource, size }: PeakBench): [number, number] {
  // Four texels a thread, a 2 × 2 block: one thread a texel would time the launch, not the memory.
  if (resource === 'textureStream') return [size.side / 16, size.side / 16]
  if (resource === 'texelLoad' || resource === 'texelFilter') return [size.grid / 8, size.grid / 8]
  if (resource === 'computePass' || resource === 'dependentDispatch') return [1, 1]
  return [workgroups(size.threads), 1]
}

function prepareCompute(device: GPUDevice, bench: PeakBench): PreparedPeak {
  const held: { destroy(): void }[] = []
  const module = device.createShaderModule({ code: peakWgsl(bench)! })
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  })
  const bindings = computeBindings(device, bench, held)
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: Object.entries(bindings).map(([binding, resource]) => ({
      binding: Number(binding),
      resource,
    })),
  })
  const [x, y] = dispatchOf(bench)
  // The dependent chain repeats its dispatch, each one reading and writing the same storage.
  const dispatches = bench.size.dispatches ?? 1
  return {
    encode(encoder, timestampWrites) {
      const pass = encoder.beginComputePass({ timestampWrites })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      for (let k = 0; k < dispatches; k++) pass.dispatchWorkgroups(x, y)
      pass.end()
    },
    destroy: () => held.forEach((h) => h.destroy()),
  }
}

function prepareRender(device: GPUDevice, bench: PeakBench): PreparedPeak {
  const { resource, size } = bench
  const triangles = resource === 'triangles'
  const side = size.side ?? 0
  const [width, height] = resource === 'renderPass' ? [size.width, size.height] : [side, side]
  const format: GPUTextureFormat = triangles ? 'r32uint' : 'rgba16float'
  const usage = GPUTextureUsage.RENDER_ATTACHMENT
  // The fixed cost's target holds noise: a pass that loads it reads 8 bytes a pixel.
  const targets = Array.from({ length: size.attachments ?? 1 }, () =>
    resource === 'renderPass'
      ? noiseTexture(device, width, height, usage)
      : device.createTexture({ size: [width, height], format, usage }),
  )
  const depth = triangles
    ? device.createTexture({ size: [side, side], format: 'depth32float', usage })
    : null
  const code = peakWgsl(bench)
  const module = code ? device.createShaderModule({ code }) : null
  const pipeline = module
    ? device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: targets.map(() => ({ format })) },
        depthStencil: depth
          ? { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' }
          : undefined,
      })
    : null
  const vertices = triangles ? 3 * side * side : 3
  return {
    encode(encoder, timestampWrites) {
      const pass = encoder.beginRenderPass({
        colorAttachments: targets.map((target) => ({
          view: target.createView(),
          // The fixed cost reads and writes its target whole, as a pass that loads it does.
          loadOp: resource === 'renderPass' ? 'load' : 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
        })),
        depthStencilAttachment: depth
          ? {
              view: depth.createView(),
              depthClearValue: 1,
              depthLoadOp: 'clear',
              depthStoreOp: 'store',
            }
          : undefined,
        timestampWrites,
      })
      if (pipeline) {
        pass.setPipeline(pipeline)
        pass.draw(vertices, size.layers ?? 1)
      }
      pass.end()
    },
    destroy: () => [...targets, ...(depth ? [depth] : [])].forEach((t) => t.destroy()),
  }
}

const RENDERED = new Set(['fill', 'fillMrt4', 'fragments', 'triangles', 'renderPass'])

/** Makes `bench` ready on `device`. */
export const preparePeak = (device: GPUDevice, bench: PeakBench) =>
  RENDERED.has(bench.resource) ? prepareRender(device, bench) : prepareCompute(device, bench)
