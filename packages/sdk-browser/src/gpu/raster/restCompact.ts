import { REST_COMPACT_SHADER, REST_COMPACT_WORKGROUP } from './restCompactWgsl.ts'
import { buildComputePipeline, buildComputeStages } from '../../lighting/deferred/fullscreen.ts'
import { validated } from '../core/errorScope.ts'
import { cleanupFailedHiz } from '../hiz/pipelines.ts'
import { bounceGroup, bounceLayout } from '../../bounce/bindings.ts'
import { shaderFailed } from '../core/shaderModule.ts'
import { pendingBuffers, type PendingGrowth } from '../core/tableGrowth.ts'
import type { OpenPass } from '../core/lazyComputePass.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { computeBufferEntry, sequentialEntries } from '../core/computeBindings.ts'

export type GpuRestCompact = {
  /**
   * Keeps, in each tested-half indirect command, only its surviving rows, in their order, and
   * counts them, as dispatches of the frame's compute pass, after the Hi-Z test whose verdicts
   * they read. `rows` bounds the instances a tested slot can hold — a tested half cannot hold
   * more rows than the table has drawable, `perRow` instances each — and sizes the work buffer;
   * the dispatches themselves are sized on the GPU by the partition's count of tested rows. The
   * row table is passed every frame: it is allocated after this kernel is created. True when it
   * encoded the compaction: every row the tested half then draws survives.
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
  /** The partition's frame state, whose word `ST_TESTED` counts the tested rows. */
  state: GPUBuffer
  /** The instances a row takes at most in the lists below. */
  perRow: number
  instances: GPUBuffer
  indirect: GPUBuffer
  slotOffsets: GPUBuffer
  flags: GPUBuffer
}

/**
 * Compaction of the tested half. It exists only if the draw compact and the pyramid exist:
 * without them there is neither an instance list nor a verdict to read.
 */
export async function createGpuRestCompact(
  device: GPUDevice,
  sources: RestCompactSources,
): Promise<GpuRestCompact | undefined> {
  let owned: GPUBuffer[] = []
  try {
    const uniforms = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const tileArgs = device.createBuffer({
      label: 'Trillion3D rest compaction arguments',
      size: 12,
      // `COPY_SRC` serves only the proof, which reads the arguments back.
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
    })
    owned = [uniforms, tileArgs]
    const made = await validated(device, () => restPipelines(device))
    if (!made) {
      for (const buffer of owned) buffer.destroy()
      return undefined
    }
    return restCompactOps({
      ...{ device, uniforms, tileArgs, ...made, buffers: sources, owned },
      // The copy covers the instance list's own range; the counts and tile words follow it.
      copyWords: sources.instances.size / 4,
      uniData: new Uint32Array(4),
      ...{ disposed: false, work: undefined, bound: undefined },
      ...{ bindGroup: undefined, argsGroup: undefined },
    })
  } catch {
    cleanupFailedHiz(owned)
    return undefined
  }
}

type RestState = NonNullable<Awaited<ReturnType<typeof restPipelines>>> & {
  device: GPUDevice
  uniforms: GPUBuffer
  /** The count and scatter dispatches' arguments, written by `restArgs`. */
  tileArgs: GPUBuffer
  buffers: RestCompactSources
  owned: GPUBuffer[]
  copyWords: number
  uniData: Uint32Array<ArrayBuffer>
  disposed: boolean
  work: GPUBuffer | undefined
  bound: { pages: GPUBuffer; work: GPUBuffer } | undefined
  bindGroup: GPUBindGroup | undefined
  /** Group 0 of `restArgs` alone: the uniform, the partition's state and the arguments. */
  argsGroup: GPUBindGroup | undefined
}

/** The four stages of the compaction and their layouts; undefined when the module fails. */
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
  // The argument kernel's group 0 is its own: the dispatches it feeds replace it, for an arguments
  // buffer bound as storage in the dispatch that reads it is refused.
  const argsLayout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(6, 'uniform'),
      computeBufferEntry(7, 'read-only-storage'),
      computeBufferEntry(8, 'storage'),
    ],
  })
  const [stages, argsPipeline] = await Promise.all([
    buildComputeStages(device, [layout], module, ['restCount', 'restScan', 'restScatter']),
    buildComputePipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [argsLayout] }),
      compute: { module, entryPoint: 'restArgs' },
    }),
  ])
  return {
    layout,
    argsLayout,
    argsPipeline,
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
        c.owned = [c.uniforms, c.tileArgs, next]
        return [old]
      })
    },
    rebind(next) {
      c.buffers = next
      c.copyWords = next.instances.size / 4
      // The group and the uniform are made again at the next encode.
      c.bound = c.argsGroup = undefined
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
    c.owned = [uniforms, c.tileArgs, c.work]
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
  c.argsGroup ??= device.createBindGroup({
    layout: c.argsLayout,
    entries: sequentialEntries(
      [{ buffer: uniforms }, { buffer: buffers.state }, { buffer: c.tileArgs }],
      6,
    ),
  })
  // Slots and tiles are fixed by preparation: the uniform is written only when they change.
  if (uniData[0] !== restSlots || uniData[1] !== tiles) {
    uniData.set([restSlots, tiles, c.copyWords, buffers.perRow])
    device.queue.writeBuffer(uniforms, 0, uniData)
  }
  const pass = open.pass
  pass.setBindGroup(0, c.argsGroup)
  pass.setPipeline(c.argsPipeline)
  pass.dispatchWorkgroups(1)
  // A slot up z, its tiles in rows along x and y, as many as the tested rows can fill.
  pass.setBindGroup(0, c.bindGroup!)
  pass.setPipeline(c.countPipeline)
  pass.dispatchWorkgroupsIndirect(c.tileArgs, 0)
  pass.setPipeline(c.scanPipeline)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(c.scatterPipeline)
  pass.dispatchWorkgroupsIndirect(c.tileArgs, 0)
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
