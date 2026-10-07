import { REST_COMPACT_SHADER, REST_COMPACT_WORKGROUP } from './restCompactWgsl.ts'
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts'
import { validated } from '../core/errorScope.ts'
import { cleanupFailedHiz } from '../hiz/pipelines.ts'
import { bounceGroup, bounceLayout } from '../../bounce/bindings.ts'
import { shaderFailed } from '../core/shaderModule.ts'
import { pendingBuffers, type PendingGrowth } from '../core/tableGrowth.ts'
import type { OpenPass } from '../core/lazyComputePass.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { dispatchGrid } from '../dispatch/grid.ts'

export type GpuRestCompact = {
  /**
   * Keeps, in each tested-half indirect command, only its surviving rows, in their order, and
   * counts them, as dispatches of the frame's compute pass, after the Hi-Z test whose verdicts
   * they read. `rows` bounds the dispatch — a tested half cannot hold more rows than the
   * table has drawable. The row table is passed every frame: it is allocated after this kernel is
   * created. True when it encoded the compaction: every row the tested half then draws survives.
   */
  encode(open: OpenPass, restSlots: number, rows: number, pages: GPUBuffer): boolean
  /** Reads `buffers` from now on: those of a draw compact and a Hi-Z test grown in place. */
  rebind(buffers: RestCompactSources): void
  /** The work buffer a table of `rows` rows, `copyWords` instance words and `restSlots` tested
   *  slots needs, made now and put in place by `commit`; nothing when the one held suffices. */
  growWork(copyWords: number, restSlots: number, rows: number): PendingGrowth | undefined
  /** The work buffer held, once an image made it or a growth did. */
  readonly work: GPUBuffer | undefined
  dispose(): void
}

/** What the compaction reads and writes: the draw compact's lists and the Hi-Z verdicts. */
type RestCompactSources = {
  instances: GPUBuffer
  indirect: GPUBuffer
  slotOffsets: GPUBuffer
  flags: GPUBuffer
}

/**
 * Compaction of the tested half. It exists only if the draw compact and the pyramid exist:
 * without them there is neither an instance list nor a verdict to read. A platform without
 * compute returns `undefined`, and the frame keeps the previous path — the second pass then
 * draws the rejected rows, each vertex discarded one by one.
 */
export async function createGpuRestCompact(
  device: GPUDevice,
  sources: RestCompactSources,
): Promise<GpuRestCompact | undefined> {
  if (typeof device.createComputePipeline !== 'function') return undefined
  let owned: GPUBuffer[] = []
  try {
    const uniforms = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    owned = [uniforms]
    const made = await validated(device, () => restPipelines(device))
    if (!made) {
      for (const buffer of owned) buffer.destroy()
      return undefined
    }
    return restCompactOps({
      ...{ device, uniforms, ...made, buffers: sources, owned },
      // The copy covers the instance list's own range; the counts and tile words follow it.
      copyWords: sources.instances.size / 4,
      uniData: new Uint32Array(4),
      ...{ disposed: false, work: undefined, bound: undefined, bindGroup: undefined },
    })
  } catch {
    cleanupFailedHiz(owned)
    return undefined
  }
}

type RestState = NonNullable<Awaited<ReturnType<typeof restPipelines>>> & {
  device: GPUDevice
  uniforms: GPUBuffer
  buffers: RestCompactSources
  owned: GPUBuffer[]
  copyWords: number
  uniData: Uint32Array<ArrayBuffer>
  disposed: boolean
  work: GPUBuffer | undefined
  bound: { pages: GPUBuffer; work: GPUBuffer } | undefined
  bindGroup: GPUBindGroup | undefined
}

/** The three stages of the compaction and their layout; undefined when the module fails. */
async function restPipelines(device: GPUDevice) {
  const layout = bounceLayout(device, [
    'storage',
    'storage',
    'read-only-storage',
    'read-only-storage',
    'read-only-storage',
    'storage',
    'uniform',
  ])
  const module = device.createShaderModule({ code: REST_COMPACT_SHADER })
  if (await shaderFailed(module)) return undefined
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const stages = await buildComputeStages(device, pipelineLayout, module, [
    'restCount',
    'restScan',
    'restScatter',
  ])
  return {
    layout,
    countPipeline: stages.restCount,
    scanPipeline: stages.restScan,
    scatterPipeline: stages.restScatter,
  }
}

function restCompactOps(c: RestState): GpuRestCompact {
  return {
    encode: (open, restSlots, rows, pages) => encodeRest(c, open, restSlots, rows, pages),
    get work() {
      return c.work
    },
    growWork(nextWords, restSlots, rows) {
      const words = workWords(nextWords, restSlots, rows)
      if (c.work && c.work.size >= words * 4) return undefined
      const next = workBuffer(c.device, words)
      return pendingBuffers([next], () => {
        const old = c.work
        c.work = next
        c.owned = [c.uniforms, next]
        return [old]
      })
    },
    rebind(next) {
      c.buffers = next
      c.copyWords = next.instances.size / 4
      // The group and the uniform are made again at the next encode.
      c.bound = undefined
      c.uniData[0] = 0
    },
    dispose() {
      c.disposed = true
      for (const buffer of c.owned) buffer.destroy()
    },
  }
}

function encodeRest(
  c: RestState,
  open: OpenPass,
  restSlots: number,
  rows: number,
  pages: GPUBuffer,
) {
  const { device, uniforms, uniData, buffers } = c
  if (c.disposed || restSlots < 1 || rows < 1) return false
  const tiles = ceilDiv(rows, REST_COMPACT_WORKGROUP)
  const words = workWords(c.copyWords, restSlots, rows)
  // The work buffer only grows: a frame with more rows or slots reallocates it once.
  if (!c.work || c.work.size < words * 4) {
    c.work?.destroy()
    c.work = workBuffer(device, words)
    c.owned = [uniforms, c.work]
  }
  const work = c.work
  if (c.bound?.pages !== pages || c.bound.work !== work) {
    c.bound = { pages, work }
    c.bindGroup = bounceGroup(device, c.layout, [
      buffers.instances,
      buffers.indirect,
      buffers.slotOffsets,
      pages,
      buffers.flags,
      work,
      uniforms,
    ])
  }
  // Slots and tiles are fixed by preparation: the uniform is written only when they change.
  if (uniData[0] !== restSlots || uniData[1] !== tiles) {
    uniData.set([restSlots, tiles, c.copyWords, 0])
    device.queue.writeBuffer(uniforms, 0, uniData)
  }
  const pass = open.pass,
    // A slot up z, its tiles in rows along x and y.
    [x, y] = dispatchGrid(tiles)
  pass.setBindGroup(0, c.bindGroup!)
  pass.setPipeline(c.countPipeline)
  pass.dispatchWorkgroups(x, y, restSlots)
  pass.setPipeline(c.scanPipeline)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(c.scatterPipeline)
  pass.dispatchWorkgroups(x, y, restSlots)
  return true
}

/** Words of the work buffer: the instance list's copy, then each tested slot's count and tiles. */
const workWords = (copyWords: number, restSlots: number, rows: number) =>
  copyWords + restSlots * (1 + ceilDiv(rows, REST_COMPACT_WORKGROUP))

const workBuffer = (device: GPUDevice, words: number) =>
  device.createBuffer({
    label: 'Trillion3D rest compaction work',
    size: words * 4,
    usage: GPUBufferUsage.STORAGE,
  })
