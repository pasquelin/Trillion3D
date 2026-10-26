import {
  GPU_BENCHMARK_ITERATIONS,
  GPU_BENCHMARK_RESOLUTION,
  GPU_BENCHMARK_VERTICES,
  GPU_METHODS,
} from '../../../../sdk-core/src/runtime/hardwareBenchmark.ts'
import { createTimingQueries } from '../timing/encoder.ts'
import { BENCHMARK_FORMAT, VERTEX_BYTES } from './benchmarkPipelines.ts'

/** The long pass's target. */
const LONG_WIDTH = 1920
const LONG_HEIGHT = 1080
/** Bytes between two rectangles' heights: the uniform offsets' alignment. */
export const UNIFORM_STRIDE = 256
/** The timestamps of a run: one after the long pass, two (start and end of its pass) for each test
 *  of each iteration. */
export const STAMPS = 2 * GPU_BENCHMARK_ITERATIONS * GPU_METHODS.length + 1

type Owned = GPUBuffer | GPUTexture | GPUQuerySet

/** The attributes test's vertices: the first attribute's x is the vertex's index, the rest zero. */
function vertexBuffer(device: GPUDevice) {
  const vertices = device.createBuffer({
    label: 'Trillion3D benchmark vertices',
    size: GPU_BENCHMARK_VERTICES * VERTEX_BYTES,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  })
  const floats = new Float32Array(vertices.getMappedRange())
  for (let index = 0; index < GPU_BENCHMARK_VERTICES; index++)
    floats[(index * VERTEX_BYTES) / 4] = index
  vertices.unmap()
  return vertices
}

/** The long pass's strip over the whole target. */
function stripBuffer(device: GPUDevice) {
  const strip = device.createBuffer({
    label: 'Trillion3D benchmark long strip',
    size: 64,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  })
  new Float32Array(strip.getMappedRange()).set([-1, 1, 0, 1, 1, 1, 0, 1, -1, -1, 0, 1, 1, -1, 0, 1])
  strip.unmap()
  return strip
}

/** A render target of `width` by `height`, read by a later pass when `read`. */
const target = (device: GPUDevice, width: number, height: number, read: boolean) =>
  device.createTexture({
    label: 'Trillion3D benchmark target',
    size: [width, height],
    format: BENCHMARK_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | (read ? GPUTextureUsage.TEXTURE_BINDING : 0),
  })

/**
 * What the graphics test draws with on `device`, `layout` the rectangle's: two 512² targets drawn
 * in turn — each pass reads the other through `reads[1 - write]` —, the long pass's target and
 * strip, the rectangles' heights, the vertex test's buffer, and the timestamps of a run and of the
 * long pass's measure. `destroy` gives every one back.
 */
export function createBenchmarkTargets(device: GPUDevice, layout: GPUBindGroupLayout) {
  const side = GPU_BENCHMARK_RESOLUTION
  const owned: Owned[] = []
  const own = <T extends Owned>(resource: T) => (owned.push(resource), resource)
  const pingPong = [own(target(device, side, side, true)), own(target(device, side, side, true))]
  const heights = own(
    device.createBuffer({
      label: 'Trillion3D benchmark rectangles',
      size: (GPU_BENCHMARK_ITERATIONS + 1) * UNIFORM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  )
  const sampler = device.createSampler({ label: 'Trillion3D benchmark point clamp' })
  const timed = createTimingQueries(device, STAMPS)
  const measured = createTimingQueries(device, 2)
  for (const resource of [...timed.sets, timed.resolve, ...measured.sets, measured.resolve])
    own(resource)
  return {
    heights,
    timed,
    measured,
    vertices: own(vertexBuffer(device)),
    strip: own(stripBuffer(device)),
    longView: own(target(device, LONG_WIDTH, LONG_HEIGHT, false)).createView(),
    writes: pingPong.map((texture) => texture.createView()),
    reads: pingPong.map((texture) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: heights, size: 16 } },
          { binding: 1, resource: texture.createView() },
          { binding: 2, resource: sampler },
        ],
      }),
    ),
    destroy() {
      for (const resource of owned) resource.destroy()
    },
  }
}
/** What `createBenchmarkTargets` makes. */
export type BenchmarkTargets = ReturnType<typeof createBenchmarkTargets>
