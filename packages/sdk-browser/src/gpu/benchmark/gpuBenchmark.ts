import {
  GPU_BENCHMARK_ITERATIONS,
  GPU_BENCHMARK_PRIMITIVES,
  GPU_BENCHMARK_RESOLUTION,
  GPU_BENCHMARK_VERTICES,
  GPU_METHODS,
  iterationWorkScale,
  measuresOf,
  type BenchmarkMeasure,
} from '../../../../sdk-core/src/runtime/hardwareBenchmark.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { captureRead } from '../core/heldReadback.ts'
import { createBenchmarkPipelines } from './benchmarkPipelines.ts'
import {
  createBenchmarkTargets,
  STAMPS,
  UNIFORM_STRIDE,
  type BenchmarkTargets,
} from './benchmarkTargets.ts'

/** Strips the long pass's length is measured over, the milliseconds it is then sized to, and the
 *  most strips it draws. */
const LONG_MEASURED_DRAWS = 5
const LONG_MILLISECONDS = 500
const LONG_MAX_DRAWS = 2000
/** Iterations encoded in one submission. */
const ITERATIONS_A_SUBMIT = 10
/** The test that reads the vertex buffer. */
const ATTRIBUTES_METHOD = GPU_METHODS.findIndex((method) => method.name === 'vertexAttributes')

const f = Math.fround
type Pipelines = Awaited<ReturnType<typeof createBenchmarkPipelines>>
type Queries = BenchmarkTargets['timed']

/** The long pass: `draws` strips of the long program over the long target, closed by `stamps`. */
function longPass(
  encoder: GPUCommandEncoder,
  { long }: Pipelines,
  targets: BenchmarkTargets,
  draws: number,
  stamps: GPURenderPassTimestampWrites,
) {
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D benchmark long pass',
    colorAttachments: [{ view: targets.longView, loadOp: 'clear', storeOp: 'store' }],
    timestampWrites: stamps,
  })
  pass.setPipeline(long)
  pass.setVertexBuffer(0, targets.strip)
  for (let draw = 0; draw < draws; draw++) pass.draw(4)
  pass.end()
}

/** Draws test `method` of iteration `iteration` at `scale` into target `write`, reading the other. */
function drawMethod(
  pass: GPURenderPassEncoder,
  targets: BenchmarkTargets,
  method: number,
  scale: number,
  iteration: number,
  write: number,
) {
  if (GPU_METHODS[method].kind === 'vertex') {
    if (method === ATTRIBUTES_METHOD) pass.setVertexBuffer(0, targets.vertices)
    let left = Math.ceil(f(GPU_BENCHMARK_PRIMITIVES * scale)) * 3
    while (left !== 0) {
      const count = Math.min(left, GPU_BENCHMARK_VERTICES)
      pass.draw(Math.floor(count / 3) * 3)
      left -= count
    }
    return
  }
  const side = GPU_BENCHMARK_RESOLUTION
  const rectangles = Math.ceil(f(f(side * scale) / side))
  for (let i = 0; i < rectangles; i++) {
    const last = i === rectangles - 1
    pass.setBindGroup(0, targets.reads[1 - write], [last ? (iteration + 1) * UNIFORM_STRIDE : 0])
    pass.draw(6)
  }
}

/** Each iteration's work at `workScale`, its last rectangle's height written into the heights (the
 *  first entry the full 512 rows). */
function writeHeights(device: GPUDevice, targets: BenchmarkTargets, workScale: number) {
  const side = GPU_BENCHMARK_RESOLUTION
  const scales: number[] = []
  const rows = new Float32Array(((GPU_BENCHMARK_ITERATIONS + 1) * UNIFORM_STRIDE) / 4)
  rows[0] = side
  for (let iteration = 0; iteration < GPU_BENCHMARK_ITERATIONS; iteration++) {
    const scale = iterationWorkScale(iteration, workScale)
    scales.push(scale)
    const height = f(side * scale)
    const top = (Math.ceil(f(height / side)) - 1) * side
    rows[((iteration + 1) * UNIFORM_STRIDE) / 4] = f(Math.min(top + side, height) - top)
  }
  device.queue.writeBuffer(targets.heights, 0, rows)
  return scales
}

/** Submits a run: the long pass, closed by timestamp 0, then each test of each iteration in its own
 *  pass, closed by its timestamp; a submission every ten iterations. */
function submitRun(
  device: GPUDevice,
  pipelines: Pipelines,
  targets: BenchmarkTargets,
  draws: number,
  scales: number[],
) {
  const querySet = targets.timed.sets[0]
  let encoder = device.createCommandEncoder({ label: 'Trillion3D benchmark' })
  longPass(encoder, pipelines, targets, draws, { querySet, endOfPassWriteIndex: 0 })
  let write = 0
  for (let iteration = 0; iteration < GPU_BENCHMARK_ITERATIONS; iteration++) {
    if (iteration % ITERATIONS_A_SUBMIT === 0) {
      device.queue.submit([encoder.finish()])
      encoder = device.createCommandEncoder({ label: 'Trillion3D benchmark' })
    }
    for (let method = 0; method < GPU_METHODS.length; method++) {
      const pass = encoder.beginRenderPass({
        label: `Trillion3D benchmark ${GPU_METHODS[method].name}`,
        colorAttachments: [{ view: targets.writes[write], loadOp: 'load', storeOp: 'store' }],
        timestampWrites: {
          querySet,
          beginningOfPassWriteIndex: 1 + 2 * (iteration * GPU_METHODS.length + method),
          endOfPassWriteIndex: 2 + 2 * (iteration * GPU_METHODS.length + method),
        },
      })
      pass.setPipeline(pipelines.methods[method])
      drawMethod(pass, targets, method, scales[iteration], iteration, write)
      pass.end()
      write = 1 - write
    }
  }
  device.queue.submit([encoder.finish()])
}

/** The first `count` timestamps of `queries`, resolved and read back. */
const readStamps = (device: GPUDevice, queries: Queries, count: number) =>
  captureRead(
    device,
    count * 8,
    'Trillion3D benchmark timestamps',
    (encoder, staging) => {
      encoder.resolveQuerySet(queries.sets[0], 0, count, queries.resolve, 0)
      encoder.copyBufferToBuffer(queries.resolve, 0, staging, 0, count * 8)
    },
    (mapped) => new BigUint64Array(mapped.slice(0, count * 8)),
  )

/** The strips the long pass draws to last half a second: five timed, then scaled. */
async function longDraws(device: GPUDevice, pipelines: Pipelines, targets: BenchmarkTargets) {
  const encoder = device.createCommandEncoder({ label: 'Trillion3D benchmark long measure' })
  longPass(encoder, pipelines, targets, LONG_MEASURED_DRAWS, {
    querySet: targets.measured.sets[0],
    beginningOfPassWriteIndex: 0,
    endOfPassWriteIndex: 1,
  })
  device.queue.submit([encoder.finish()])
  const stamps = await readStamps(device, targets.measured, 2)
  const microseconds = Number(BigInt.asUintN(64, stamps[1] / 1000n - stamps[0] / 1000n))
  const perDraw = f(f(microseconds / 1000) / LONG_MEASURED_DRAWS)
  return clamp(Math.floor(LONG_MILLISECONDS / perDraw), 1, LONG_MAX_DRAWS)
}

/**
 * The graphics test on `device`, which must have GPU timestamps (`benchmarkPipelines.ts`,
 * `benchmarkTargets.ts`). `run` measures each test at a work scale — 70 iterations of every test,
 * timed between the timestamps that close their passes, normalized by their work and made robust
 * (`measuresOf`) — and answers the timestamps too; `destroy` gives everything back.
 */
export async function createGpuBenchmark(device: GPUDevice) {
  const pipelines = await createBenchmarkPipelines(device)
  const targets = createBenchmarkTargets(device, pipelines.layout)
  return {
    async run(
      workScale: number,
    ): Promise<{ measures: BenchmarkMeasure[]; stamps: BigUint64Array }> {
      const draws = await longDraws(device, pipelines, targets)
      const scales = writeHeights(device, targets, workScale)
      submitRun(device, pipelines, targets, draws, scales)
      const stamps = await readStamps(device, targets.timed, STAMPS)
      return { measures: measuresOf(stamps, scales), stamps }
    },
    destroy: () => targets.destroy(),
  }
}
