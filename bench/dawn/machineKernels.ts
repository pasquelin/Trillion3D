// The kernels that measure a machine: each runs alone on the engine's device, timed by two GPU
// timestamps, and says how long its fixed work took. `machine.ts` turns the times into rates.
import type { BenchGpu } from './device.ts'
import { readBack } from './readBack.ts'

const MIB = 1 << 20
/** A buffer a kernel streams: 128 MiB, the storage binding every device grants. */
export const STREAM_BYTES = 128 * MIB
/** A texture a kernel streams: 4096 × 4096 of `rgba16float`, 128 MiB. */
export const TEXTURE_SIDE = 4096
export const TEXTURE_BYTES = TEXTURE_SIDE * TEXTURE_SIDE * 8
/** Threads, workgroups and passes the overhead kernels run. */
export const THREAD_GROUPS = 32768
export const GROUP_THREADS = 256
export const CHAIN = 64

const READ = /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> sink: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  let total = arrayLength(&src) / 8u;
  var sum = vec4f(0.0);
  for (var k = 0u; k < 8u; k++) { sum += src[id.x + k * total]; }
  sink[id.x] = sum.x + sum.y + sum.z + sum.w;
}`
const WRITE = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> dst: array<vec4f>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  let total = arrayLength(&dst) / 8u;
  for (var k = 0u; k < 8u; k++) { dst[id.x + k * total] = vec4f(f32(id.x), f32(k), 1.0, 1.0); }
}`
const TEXTURE_READ = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> sink: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  var sum = vec4f(0.0);
  for (var k = 0u; k < 16u; k++) {
    let at = id.x + k * 1048576u;
    sum += textureLoad(src, vec2u(at % 4096u, at / 4096u), 0);
  }
  sink[id.x] = sum.x + sum.y + sum.z + sum.w;
}`
const TEXTURE_WRITE = /* wgsl */ `
@group(0) @binding(0) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  for (var k = 0u; k < 16u; k++) {
    let at = id.x + k * 1048576u;
    textureStore(dst, vec2u(at % 4096u, at / 4096u), vec4f(f32(id.x), f32(k), 1.0, 1.0));
  }
}`
const TRIVIAL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> sink: array<u32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x == 0xFFFFFFFFu) { sink[0] = 1u; }
}`
const CHAINED = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> sink: array<u32>;
@compute @workgroup_size(1) fn main() { sink[0] = sink[0] + 1u; }`
const FILL = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.25, 0.5, 0.75, 1.0); }`

/** The kernels of a device: `time(name)` runs one, alone on an idle queue, and returns its ms. */
export function createKernels(gpu: Pick<BenchGpu, 'quiet'>, device: GPUDevice) {
  const usage = GPUBufferUsage
  const set = device.createQuerySet({ type: 'timestamp', count: 2 })
  const resolved = device.createBuffer({ size: 16, usage: usage.QUERY_RESOLVE | usage.COPY_SRC })
  const read = device.createBuffer({ size: 16, usage: usage.MAP_READ | usage.COPY_DST })
  const buffer = (size: number) => device.createBuffer({ size, usage: usage.STORAGE })
  const stream = buffer(STREAM_BYTES),
    sink = buffer(STREAM_BYTES / 8),
    other = buffer(256)
  const texture = (use: number) =>
    device.createTexture({ size: [TEXTURE_SIDE, TEXTURE_SIDE], format: 'rgba16float', usage: use })
  const sampled = texture(GPUTextureUsage.TEXTURE_BINDING)
  const stored = texture(GPUTextureUsage.STORAGE_BINDING)
  const target = texture(GPUTextureUsage.RENDER_ATTACHMENT)
  const compute = (code: string) =>
    device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
    })
  const bind = (p: GPUComputePipeline, ...resources: GPUBindingResource[]) =>
    device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource })),
    })
  const [pRead, pWrite, pTexRead, pTexWrite, pTrivial, pChained] = [
    READ,
    WRITE,
    TEXTURE_READ,
    TEXTURE_WRITE,
    TRIVIAL,
    CHAINED,
  ].map(compute)
  const module = device.createShaderModule({ code: FILL })
  const pFill = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
  })
  const threads = STREAM_BYTES / 16 / 8
  const groups = threads / GROUP_THREADS
  const dispatch = (
    pass: GPUComputePassEncoder,
    p: GPUComputePipeline,
    g: GPUBindGroup,
    n: number,
  ) => {
    pass.setPipeline(p)
    pass.setBindGroup(0, g)
    pass.dispatchWorkgroups(n)
  }
  const stamps = { querySet: set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 }
  /** Runs `encode` on a fresh encoder, timestamps resolved after it: the ms between the stamps. */
  const run = async (encode: (encoder: GPUCommandEncoder) => void) => {
    await device.queue.onSubmittedWorkDone()
    const out = await readBack(gpu, device, read, 16, (encoder) => {
      encode(encoder)
      encoder.resolveQuerySet(set, 0, 2, resolved, 0)
      encoder.copyBufferToBuffer(resolved, 0, read, 0, 16)
    })
    const [begin, end] = new BigInt64Array(out)
    return Number(end - begin) / 1e6
  }
  const one = (encode: (pass: GPUComputePassEncoder) => void) =>
    run((encoder) => {
      const pass = encoder.beginComputePass({ timestampWrites: stamps })
      encode(pass)
      pass.end()
    })
  const bindings = {
    read: bind(pRead, { buffer: stream }, { buffer: sink }),
    write: bind(pWrite, { buffer: stream }),
    texRead: bind(pTexRead, sampled.createView(), { buffer: sink }),
    texWrite: bind(pTexWrite, stored.createView()),
    trivial: bind(pTrivial, { buffer: other }),
    chained: bind(pChained, { buffer: other }),
  }
  const kernels = {
    /** 128 MiB read once, summed. */
    read: () => one((p) => dispatch(p, pRead, bindings.read, groups)),
    write: () => one((p) => dispatch(p, pWrite, bindings.write, groups)),
    textureRead: () => one((p) => dispatch(p, pTexRead, bindings.texRead, groups)),
    textureWrite: () => one((p) => dispatch(p, pTexWrite, bindings.texWrite, groups)),
    /** `THREAD_GROUPS` workgroups of `GROUP_THREADS` threads that touch no memory. */
    threads: () => one((p) => dispatch(p, pTrivial, bindings.trivial, THREAD_GROUPS)),
    /** One full-target triangle: the attachment's pixels stored. */
    attachment: () =>
      run((encoder) => {
        const pass = encoder.beginRenderPass({
          timestampWrites: stamps,
          colorAttachments: [
            {
              view: target.createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: [0, 0, 0, 0],
            },
          ],
        })
        pass.setPipeline(pFill)
        pass.draw(3)
        pass.end()
      }),
    /** `CHAIN` one-thread dispatches each reading what the last wrote, in one pass: a barrier each. */
    dependent: () =>
      one((p) => {
        for (let i = 0; i < CHAIN; i++) dispatch(p, pChained, bindings.chained, 1)
      }),
    /** `CHAIN` one-thread dispatches that touch nothing in common: no barrier between them. */
    independent: () =>
      one((p) => {
        for (let i = 0; i < CHAIN; i++) dispatch(p, pTrivial, bindings.trivial, 1)
      }),
    /** `CHAIN` compute passes of one workgroup, from the first's begin to the last's end. */
    passes: () =>
      run((encoder) => {
        for (let i = 0; i < CHAIN; i++) {
          const pass = encoder.beginComputePass(
            i === 0 || i === CHAIN - 1
              ? {
                  timestampWrites: {
                    querySet: set,
                    ...(i === 0 ? { beginningOfPassWriteIndex: 0 } : { endOfPassWriteIndex: 1 }),
                  },
                }
              : undefined,
          )
          dispatch(pass, pTrivial, bindings.trivial, 1)
          pass.end()
        }
      }),
  }
  return {
    kernels,
    destroy() {
      for (const held of [set, resolved, read, stream, sink, other, sampled, stored, target])
        held.destroy()
    },
  }
}
export type Kernels = ReturnType<typeof createKernels>['kernels']
