// The machine's own limits, measured once and kept: how many GB/s it reads, writes, copies, stores
// into an attachment, how many threads it launches a ms, what a pass, a dispatch and a barrier cost.
// A pass's floor is its bytes over these rates, its threads over the launch rate: the time it
// could not beat on this GPU, whatever its shader.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { measureOutput } from '../core/paths.ts'
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

/** What a machine can do, from timed kernels. Rates in GB/s (10⁹ bytes a second), costs in ms. */
/** Changes when a kernel does: a machine file of another version is measured again. */
const MACHINE_VERSION = 2

export type Machine = {
  version: number
  adapter: string
  date: string
  readGBs: number
  writeGBs: number
  textureReadGBs: number
  textureWriteGBs: number
  attachmentGBs: number
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

/** The cache file of an adapter, off git (`.mesure/` is). */
const fileOf = (adapter: string) =>
  join(measureOutput('..', 'machine'), `${adapter.replace(/[^\w.-]+/g, '-')}.json`)

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
    threadsPerMs: (THREAD_GROUPS * GROUP_THREADS) / ms.threads,
    passMs: ms.passes / CHAIN,
    dispatchMs: ms.independent / CHAIN,
    barrierMs: Math.max(0, (ms.dependent - ms.independent) / CHAIN),
  }
}

/** Measures the machine on the engine's device: every kernel, its commands uncounted. */
export async function measureMachine(gpu: BenchGpu, device: GPUDevice, adapter: string) {
  device.pushErrorScope('validation')
  const { kernels, destroy } = createKernels(gpu, device)
  const refused = await device.popErrorScope()
  if (refused) throw new Error(`BENCH_MACHINE: ${refused.message}`)
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
    const kept = JSON.parse(readFileSync(file, 'utf8')) as Machine
    if (kept.version === MACHINE_VERSION) return kept
  }
  const machine = await measureMachine(gpu, device, adapter)
  if (!keep) return { ...machine, disturbed: true }
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(machine, null, 1))
  return machine
}
