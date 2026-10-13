// The chunk bound on the device's own histograms (`vsm/rowBinsWgsl.ts`, the shipped kernel): an
// oblique low sun and a spot over a dense scene, half of its rows moving; the histogram binned on
// Dawn, read back, landed (`landRowBins`); then the moving rows travel, within the margin they were
// binned at and past it. Every frame, every K, the bound is held against the exact count of the
// shipped cull at the rows' places (`bruteForce`, `bruteForceLocal`): the times it falls short.
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { MOBILITY_MOVING } from '../../../packages/sdk-browser/src/gpu/shadow/mobilityBits.ts'
import { commitMotion } from '../../../packages/sdk-browser/src/gpu/shadow/rowMotion.ts'
import { createVsmClipmap } from '../../../packages/sdk-browser/src/vsm/clipmap.ts'
import { PROJECTION, VIEW } from '../../../packages/sdk-browser/src/vsm/clipmap.fixture.ts'
import { rowBinTables } from '../../../packages/sdk-browser/src/vsm/rowBins.ts'
import { binRows, topSums } from '../../../packages/sdk-browser/src/vsm/rowBins.fixture.ts'
import { rowBinsRequest } from '../../../packages/sdk-browser/src/vsm/rowBinsParams.ts'
import { landRowBins } from '../../../packages/sdk-browser/src/vsm/rowBinsRecord.ts'
import { ROW_BINS_WGSL } from '../../../packages/sdk-browser/src/vsm/rowBinsWgsl.ts'
import {
  createVsmRowBound,
  vsmBoundChunk,
  type VsmBoundLight,
} from '../../../packages/sdk-browser/src/vsm/rowPageBound.ts'
import {
  bruteForce,
  bruteForceLocal,
  localAt,
  PAGES,
  scene,
  worstOf,
  type SceneRows,
} from '../../../packages/sdk-browser/src/vsm/rowPageBound.fixture.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { autoKernel, bufferHolding, groupZero } from '../kit/computeReadback.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

const N = 3000

/** A low sun, its clipmap around `eye`, as the frame's light. */
function lowSun(cache: ReturnType<typeof localAt>['cache'], eye: number[]): VsmBoundLight {
  const clipmap = createVsmClipmap(
    cache,
    { id: 'low sun', direction: [0.82, -0.28, 0.5] },
    { view: VIEW, projection: PROJECTION, perspective: true, eye },
    { width: 1024, height: 1024 },
  )
  return {
    kind: 'directional',
    firstId: 0,
    count: clipmap.levels.length,
    shouldRender: true,
    clipmap,
  }
}

/** Every moving row moved by `step`, the frame's travel committed. */
function move(rows: SceneRows, step: number[]) {
  for (let i = 0; i < N; i++) {
    if (!rows.moving[i]) continue
    for (let a = 0; a < 3; a++) {
      const at = i * 8,
        c = rows.packed[at + a] + rows.packed[at + 4 + a] + step[a]
      rows.packed[at + a] = Math.fround(c)
      rows.packed[at + 4 + a] = c - rows.packed[at + a]
    }
  }
  commitMotion(rows.spheres.motion, 0, Math.hypot(...step))
}

/** Every K where the bound falls short of the exact count, this frame. */
function shortfalls(
  rows: SceneRows,
  lights: VsmBoundLight[],
  chunk: ReturnType<typeof vsmBoundChunk>,
) {
  if (!chunk) return -1
  const pairs = new Float64Array(N),
    cmds = new Float64Array(N)
  for (const light of lights) {
    const truth = light.clipmap ? bruteForce(rows, light, PAGES) : bruteForceLocal(rows, light)
    truth.pairs.forEach((v, i) => ((pairs[i] += v), (cmds[i] += truth.cmds[i])))
  }
  const top = topSums(pairs.map((v) => Math.min(v, PAGES))),
    topCmds = topSums(cmds)
  let short = 0
  for (let k = 1; k <= N; k += 7) if (chunk.pairs(k) < top[k] || chunk.cmds(k) < topCmds[k]) short++
  return short
}

export async function runRowBins() {
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: true as const }
  const { device } = gpu
  const { module, compilation } = await gpu.compile(ROW_BINS_WGSL)
  if (compilation.length) return { errors: compilation }
  const pipeline = await device.createComputePipelineAsync(autoKernel(module))
  // Dense: rows a few centimetres to a metre wide over 120 m, the eye among them.
  const rows = scene(N, [0, 1, 0], 120, 0.03, 1, 17)
  for (let i = 0; i < N; i += 2) rows.moving[i] = 1
  const { cache, light: spot } = localAt({
    kind: 'spot',
    position: [4, 6, -3],
    direction: [0.3, -1, 0.2],
    range: 30,
    coneAngle: 0.7,
  })
  const lights = [lowSun(cache, [0.5, 1.7, -0.4]), spot]
  const worst = { ...worstOf(), cmdsPerRow: 64 },
    range = { first: 0, end: N, candidates: N }
  // The placements went 1.5 m a frame before: the moving rows are binned that far grown.
  for (let f = 0; f < 10; f++) commitMotion(rows.spheres.motion, 0, 1.5)
  const bound = createVsmRowBound()
  vsmBoundChunk(bound, rows.spheres, range, lights, worst)
  const request = rowBinsRequest(bound.bins, rows.spheres, range, lights)!
  const { tag, params } = request,
    bytes = tag.words * 4
  const oracle = binRows(params, rows, tag.words)
  const STORAGE = GPUBufferUsage.STORAGE
  const mobility = Uint32Array.from(rows.moving, (m) => (m ? MOBILITY_MOVING : 0))
  const bins = gpu.buffer(bytes, STORAGE | GPUBufferUsage.COPY_SRC)
  const inputs = [rows.packed, mobility, params.slice(), rowBinTables()].map((data) =>
    bufferHolding(device, data, STORAGE, 16),
  )
  const group = groupZero(
    device,
    pipeline,
    [...inputs, bins].map((buffer) => ({ buffer })),
  )
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(ceilDiv(N, 64))
  pass.end()
  device.queue.submit([encoder.finish()])
  const read = (await readGpuBuffer(device, bins, bytes))!
  const { court } = await gpu.fermer()
  const counts = new Uint32Array(read.buffer, read.byteOffset, tag.words)
  let binsDiffer = 0
  for (let i = 0; i < tag.words; i++) binsDiffer += Math.abs(counts[i] - oracle[i])
  landRowBins(bound.bins, tag, counts.slice().buffer)
  // Frames: the moving rows within their margin, then far past it.
  const short: number[] = []
  for (const step of [
    [1.1, 0, -0.9],
    [0.8, 0.3, -1.2],
    [1.3, 0, 0.4],
    [-45, 0, 30],
  ]) {
    move(rows, step)
    short.push(shortfalls(rows, lights, vsmBoundChunk(bound, rows.spheres, range, lights, worst)))
  }
  return {
    adapter: court,
    errors: gpu.errors,
    binsDiffer,
    short,
    movingRows: bound.bins.landed?.movingRows,
  }
}
