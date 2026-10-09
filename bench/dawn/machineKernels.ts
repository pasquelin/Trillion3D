// The kernels that measure a machine: each runs alone on the engine's device, timed by two GPU
// timestamps, and says how long its fixed work took. `machine.ts` turns the times into rates.
import type { BenchGpu } from './device.ts'
import { CHAINED, FILL, READ, TEXTURE_READ, TEXTURE_WRITE, TRIVIAL, WRITE } from './machineWgsl.ts'
import { MIB } from '../../packages/math/src/constants.ts'
import { readBack } from './readBack.ts'
import { createWorkKernels } from './machineWork.ts'
import { machineParts } from './machineParts.ts'

/** A buffer a kernel streams: 128 MiB, the storage binding every device grants. */
export const STREAM_BYTES = 128 * MIB
/** A texture a kernel streams: 4096 × 4096 of `rgba16float`, 128 MiB. */
const TEXTURE_SIDE = 4096
export const TEXTURE_BYTES = TEXTURE_SIDE * TEXTURE_SIDE * 8
/** Threads, workgroups and passes the overhead kernels run. */
export const THREAD_GROUPS = 32768
export const GROUP_THREADS = 256
export const CHAIN = 64

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
  /** One small buffer a dispatch of its own: dispatches that share none need no barrier. */
  const apart = Array.from({ length: CHAIN }, () => buffer(256))
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
  const parts = machineParts(device, { run, stamps }),
    { compute, bind, raster } = parts
  const texture = (use: number) => parts.texture(TEXTURE_SIDE, 'rgba16float', use)
  const sampled = texture(GPUTextureUsage.TEXTURE_BINDING)
  const stored = texture(GPUTextureUsage.STORAGE_BINDING)
  const target = texture(GPUTextureUsage.RENDER_ATTACHMENT)
  const [pRead, pWrite, pTexRead, pTexWrite, pTrivial, pChained] = [
    READ,
    WRITE,
    TEXTURE_READ,
    TEXTURE_WRITE,
    TRIVIAL,
    CHAINED,
  ].map(compute)
  const pFill = raster(FILL, ['rgba16float'])
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
    apart: apart.map((buffer) => bind(pChained, { buffer })),
  }
  const work = createWorkKernels(device, { parts, one }, { fill: pFill, target })
  const kernels = {
    ...work.kernels,
    /** 128 MiB read once, summed. */
    read: () => one((p) => dispatch(p, pRead, bindings.read, groups)),
    write: () => one((p) => dispatch(p, pWrite, bindings.write, groups)),
    textureRead: () => one((p) => dispatch(p, pTexRead, bindings.texRead, groups)),
    textureWrite: () => one((p) => dispatch(p, pTexWrite, bindings.texWrite, groups)),
    /** `THREAD_GROUPS` workgroups of `GROUP_THREADS` threads that touch no memory. */
    threads: () => one((p) => dispatch(p, pTrivial, bindings.trivial, THREAD_GROUPS)),
    /** One full-target triangle: the attachment's pixels stored. */
    attachment: () => parts.draw(pFill, [target], 3),
    /** `CHAIN` one-thread dispatches on one buffer, each reading what the last wrote: a barrier each. */
    dependent: () =>
      one((p) => {
        for (let i = 0; i < CHAIN; i++) dispatch(p, pChained, bindings.chained, 1)
      }),
    /** The same dispatches, each on a buffer of its own: nothing to wait for between them. */
    independent: () =>
      one((p) => {
        for (let i = 0; i < CHAIN; i++) dispatch(p, pChained, bindings.apart[i], 1)
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
      work.destroy()
      for (const held of [
        set,
        resolved,
        read,
        stream,
        sink,
        other,
        sampled,
        stored,
        target,
        ...apart,
      ])
        held.destroy()
    },
  }
}
