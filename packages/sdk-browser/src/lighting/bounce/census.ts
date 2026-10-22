import type { BounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { TABLE_LANES } from '../../../../sdk-core/src/bounce/probeSlots.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { buildComputeStage } from '../../gpu/core/computeStages.ts'
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { computeBufferEntry, namedEntries } from '../../gpu/core/computeBindings.ts'
import { atlasEntry } from './atlas.ts'
import {
  BOUNCE_CENSUS_SHADER,
  CENSUS,
  CENSUS_BUCKETS,
  CENSUS_CAUSES,
  CENSUS_WORDS,
} from './probes/censusWgsl.ts'
import { CENSUS_BINDINGS } from './probes/probeBindings.ts'

/** Censuses in flight at once: one an image at most, never a wait. */
const IN_FLIGHT = 2

/** What the last census that came back says of the probes (`CENSUS`), the totals counted since they were
 *  made and the field as that census found it. */
export type BounceCensus = {
  /** Censuses that came back, since the probes were made. */
  reads: number
  /** Probes whose update fired its rays, the rays it fired (every one answers: an exhausted ray as a hit),
   *  those that brought light back: totals. */
  updated: number
  fired: number
  lit: number
  /** Probes written lit, and written buried, by an update: totals. */
  written: number
  buried: number
  /** The rays that spent their budget, by what spent it: the ray's own work, its triangle tests, its
   *  walk of the placement tree, a mesh's walk; then the same four for its shadow ray: totals. An exhausted
   *  walk ends as a hit where it stopped, an exhausted shadow ray as a blocker; a ray may count in two. */
  exhaustedBy: number[]
  /** Every ray by the work it spent: under 64 units, 128, 256, 512, 1024, 2048, 4096, more: totals. */
  work: number[]
  /** The rays that answered by meeting no surface (the sky answers them), and the shadow rays that came
   *  back finding nothing on their segment (the point is lit) or a surface (it is shaded): totals. */
  escaped: number
  shadowFree: number
  shadowBlocked: number
  /** The pool as the census found it: probes that hold light, probes that hold none, probes buried, and the
   *  entries of the table that name a probe. */
  litProbes: number
  darkProbes: number
  buriedProbes: number
  publishedSlots: number
  /** The work the rays of the image counted spent, in units (`runtime/runtimeLayout.ts`): all of it, and the
   *  part the placement tree's groups took, the rest being the tree's cells and the cuts'. */
  walkWork: number
  walkMembers: number
}

/** The field's census pass over the whole pool and the whole table: its pipeline, compiled off the
 *  thread, and its one group. */
async function compileCensus(
  device: GPUDevice,
  grid: GPUBuffer,
  probes: GPUTextureView,
  census: GPUBuffer,
) {
  const module = await createCheckedShaderModule(device, BOUNCE_CENSUS_SHADER, 'BOUNCE_CENSUS')
  const B = CENSUS_BINDINGS
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(B.grid, 'uniform'),
      atlasEntry(B.probes),
      computeBufferEntry(B.census, 'storage'),
    ],
  })
  const pipeline = await buildComputeStage(device, [layout], module, 'countField')
  const group = device.createBindGroup({
    layout,
    entries: namedEntries(B, { grid: { buffer: grid }, probes, census: { buffer: census } }),
  })
  return { pipeline, group }
}

/** The census `words` hold, `reads` the censuses that came back. */
function censusOf(words: Uint32Array, reads: number): BounceCensus {
  return {
    reads,
    updated: words[CENSUS.updated],
    fired: words[CENSUS.updated] * BOUNCE_SETTINGS.raysPerProbe,
    lit: words[CENSUS.lit],
    written: words[CENSUS.written],
    buried: words[CENSUS.buried],
    exhaustedBy: Array.from(words.subarray(CENSUS.exhaustedBy, CENSUS.exhaustedBy + CENSUS_CAUSES)),
    work: Array.from(words.subarray(CENSUS.work, CENSUS.work + CENSUS_BUCKETS)),
    escaped: words[CENSUS.escaped],
    shadowFree: words[CENSUS.shadowFree],
    shadowBlocked: words[CENSUS.shadowBlocked],
    litProbes: words[CENSUS.fieldLit],
    darkProbes: words[CENSUS.fieldDark],
    buriedProbes: words[CENSUS.fieldBuried],
    publishedSlots: words[CENSUS.fieldPublished],
    walkWork: words[CENSUS.walkWork],
    walkMembers: words[CENSUS.walkMembers],
  }
}

/**
 * THE STATE OF THE FIELD, counted on the GPU and read back a few images late (`probes/censusWgsl.ts`):
 * after an image's update, a pass counts the probes of the pool that hold light and the entries of the
 * table that name one, the update having added its rays beside. A readback of the one ring: none waits,
 * an image whose buffers are all in flight counts nothing. `reading` is the last that came back, none
 * before the first.
 */
export async function createBounceCensus(
  device: GPUDevice,
  cascades: BounceCascades,
  grid: GPUBuffer,
  probes: GPUTextureView,
  census: GPUBuffer,
) {
  const { pipeline, group } = await compileCensus(device, grid, probes, census)
  const words = new Uint32Array(CENSUS_WORDS)
  let reads = 0
  const ring = createReadbackRing(
    device,
    { label: 'Trillion3D bounce census readback', bytes: CENSUS_WORDS * 4, count: IN_FLIGHT },
    (mapped) => {
      words.set(new Uint32Array(mapped, 0, CENSUS_WORDS))
      reads++
    },
  )
  const threads = cascades.probes + ceilDiv(cascades.levels.length * cascades.cells, TABLE_LANES)
  let staging: GPUBuffer | undefined, shown: BounceCensus | undefined
  return {
    /** Whether image `frame` counts: a buffer of the ring is free to bring the counts back. */
    begin(frame: number) {
      staging = ring.take(frame)
      return !!staging
    },
    /** The field's words cleared, before the pass that counts. */
    clear: (encoder: GPUCommandEncoder) =>
      encoder.clearBuffer(census, CENSUS.fieldLit * 4, (CENSUS_WORDS - CENSUS.fieldLit) * 4),
    /** The counting, in the bounce pass after the update. */
    dispatch(pass: GPUComputePassEncoder) {
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(ceilDiv(threads, WORKGROUP_THREADS), 1, 1)
    },
    /** The counts copied to the staging buffer `begin` took, after the pass. */
    copy(encoder: GPUCommandEncoder) {
      if (staging) encoder.copyBufferToBuffer(census, 0, staging, 0, CENSUS_WORDS * 4)
    },
    /** After the image's submit: its copy maps. */
    submitted: () => ring.submitted(),
    /** What the last census that came back counted, none before the first; the same object until the
     *  next one comes back. */
    reading(): BounceCensus | undefined {
      if (!reads) return undefined
      if (shown?.reads !== reads) shown = censusOf(words, reads)
      return shown
    },
    dispose() {
      ring.destroy()
    },
  }
}
