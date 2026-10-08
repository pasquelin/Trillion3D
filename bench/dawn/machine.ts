// The machine's own limits, measured once and kept: how many GB/s it reads, writes, copies, stores
// into an attachment, how many threads it launches a ms, what a pass, a dispatch and a barrier cost.
// A pass's floor is its bytes over these rates, its threads over the launch rate: the time it
// could not beat on this GPU, whatever its shader.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spread } from './summary.ts'
import type { BenchGpu } from './device.ts'
import {
  CHAIN,
  GROUP_THREADS,
  STREAM_BYTES,
  TEXTURE_BYTES,
  THREAD_GROUPS,
  createKernels,
} from './machineKernels.ts'
import {
  FMA_ITERATIONS,
  FMA_LANES,
  OVERDRAW,
  RASTER_SIDE,
  SHARED_READS,
  TAP_GRID,
  TAPS,
  TRIANGLE_SIDE,
  WORK_THREADS,
} from './machineWork.ts'

/** Changes when a kernel does: a machine file of another version is measured again. */
const MACHINE_VERSION = 3
/** A machine file older than this is measured again: drivers, clocks and cooling change. */
const MAX_AGE_DAYS = 30

/** What a machine can do, from timed kernels. Rates in GB/s (10⁹ bytes a second), costs in ms. */
export type Machine = {
  version: number
  adapter: string
  date: string
  readGBs: number
  writeGBs: number
  textureReadGBs: number
  textureWriteGBs: number
  attachmentGBs: number
  /** Texels loaded and filtered from a cached texture, a second (10⁹). */
  texelLoadG: number
  texelFilterG: number
  /** Fused multiply-adds, two operations each, a second (10¹²). */
  aluTflops: number
  /** Workgroup memory read, GB/s. */
  sharedGBs: number
  /** Pixels written to four attachments, fragments shaded and stored, triangles set up, a second
   *  (10⁹). */
  mrt4G: number
  fragmentsG: number
  trianglesG: number
  /** Threads that touch no memory, launched a ms. */
  threadsPerMs: number
  /** One compute pass of one workgroup, from its begin to the next's: the fixed cost of a pass. */
  passMs: number
  /** One dispatch beside another it shares nothing with. */
  dispatchMs: number
  /** What a dispatch costs more when it reads what the one before wrote: the barrier. */
  barrierMs: number
  /** Measured while other programs kept the GPU busy: used for this run only, never kept. */
  disturbed?: boolean
}

/** The cache file of an adapter: in the home, beside the bench lock, so every checkout and worktree
 *  of the machine shares it. */
const fileOf = (adapter: string) =>
  join(homedir(), '.trillion3d', 'machine', `${adapter.replace(/[^\w.-]+/g, '-')}.json`)

/** The median of `runs` timings of `kernel` after two it throws away. */
async function median(kernel: () => Promise<number>, runs = 7) {
  await kernel()
  await kernel()
  const times: number[] = []
  for (let i = 0; i < runs; i++) times.push(await kernel())
  return spread(times)!.median
}

/** The rates and costs the timings of the kernels make. Pure: tested on injected timings. */
export function machineFrom(adapter: string, ms: Record<string, number>, date: string): Machine {
  // A driver that gave no timestamps gives equal or reversed ones: a rate of nothing, kept for good.
  const bad = Object.entries(ms).find(([, time]) => !(Number.isFinite(time) && time > 0))
  if (bad) throw new Error(`BENCH_MACHINE: the kernel ${bad[0]} timed ${bad[1]} ms`)
  const rate = (bytes: number, time: number) => bytes / time / 1e6
  return {
    version: MACHINE_VERSION,
    adapter,
    date,
    readGBs: rate(STREAM_BYTES, ms.read),
    writeGBs: rate(STREAM_BYTES, ms.write),
    textureReadGBs: rate(TEXTURE_BYTES, ms.textureRead),
    textureWriteGBs: rate(TEXTURE_BYTES, ms.textureWrite),
    attachmentGBs: rate(TEXTURE_BYTES, ms.attachment),
    texelLoadG: rate(TAP_GRID ** 2 * TAPS, ms.texelLoad),
    texelFilterG: rate(TAP_GRID ** 2 * TAPS, ms.texelFilter),
    aluTflops: rate(2 * WORK_THREADS * FMA_ITERATIONS * FMA_LANES, ms.alu) / 1e3,
    sharedGBs: rate(WORK_THREADS * SHARED_READS * 16, ms.shared),
    mrt4G: rate(RASTER_SIDE ** 2, ms.attachments4),
    fragmentsG: rate(OVERDRAW * RASTER_SIDE ** 2, ms.fragments),
    trianglesG: rate(TRIANGLE_SIDE ** 2, ms.triangles),
    threadsPerMs: (THREAD_GROUPS * GROUP_THREADS) / ms.threads,
    passMs: ms.passes / CHAIN,
    dispatchMs: ms.independent / CHAIN,
    barrierMs: Math.max(0, (ms.dependent - ms.independent) / CHAIN),
  }
}

/** Measures the machine on the engine's device: every kernel, its commands uncounted. */
export async function measureMachine(gpu: BenchGpu, device: GPUDevice, adapter: string) {
  device.pushErrorScope('validation')
  let made: ReturnType<typeof createKernels>
  try {
    made = gpu.quiet(() => createKernels(gpu, device))
  } catch (error) {
    await device.popErrorScope()
    throw error
  }
  const { kernels, destroy } = made
  const refused = await device.popErrorScope()
  if (refused) {
    destroy()
    throw new Error(`BENCH_MACHINE: ${refused.message}`)
  }
  try {
    const ms: Record<string, number> = {}
    for (const [name, kernel] of Object.entries(kernels)) ms[name] = await median(kernel)
    return machineFrom(adapter, ms, new Date().toISOString())
  } finally {
    destroy()
  }
}

/** The machine's limits: the file kept for this adapter, or measured now and kept — once a machine,
 *  `recalibrate` measuring again. Measured while the GPU is busy with others (`keep` false), the
 *  limits are too low to be kept: they serve this run, marked `disturbed`, and the next measures
 *  again. */
export async function machineFor(
  gpu: BenchGpu,
  device: GPUDevice,
  adapter: string,
  recalibrate = false,
  keep = true,
) {
  const file = fileOf(adapter)
  if (!recalibrate && existsSync(file)) {
    try {
      const kept = JSON.parse(readFileSync(file, 'utf8')) as Machine
      const young = Date.now() - Date.parse(kept.date) < MAX_AGE_DAYS * 86_400_000
      if (kept.version === MACHINE_VERSION && young) return kept
    } catch {
      // A file cut short when its writer was killed: measured again.
    }
  }
  const machine = await measureMachine(gpu, device, adapter)
  if (!keep) return { ...machine, disturbed: true }
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(machine, null, 1))
  return machine
}
