/**
 * THE STATS ACCUMULATION (`shadowAccumulateStats`): while the setting is not 0, each frame that holds
 * shadow maps copies the stats buffer's words (`VSM_STATS_WORDS`) into the next row of a buffer that
 * lives across frames (one thread, `vsmAccumulateStats`); when the setting returns to 0, or the
 * frames it counted are done, the rows are read back once and handed out as a CSV. The setting
 * counts frames: N above 0 accumulates N frames then stops, a negative value goes on until it is
 * set back to 0.
 */
import { retire } from '../../../gpu/core/frameRetire.ts'
import { createReadbackRing } from '../../../gpu/core/readbackRing.ts'
import { computeBufferEntry } from '../../../gpu/core/computeBindings.ts'
import { VSM_PASS_PREFIX } from '../../../diagnostic/stage/passLabels.ts'
import {
  VSM_COUNT_CLEARED,
  VSM_COUNT_DYNAMIC_KEPT,
  VSM_COUNT_EMPTY_PAGES,
  VSM_COUNT_GRANTED,
  VSM_COUNT_STATIC_KEPT,
  VSM_COUNT_WANTED,
  VSM_COUNT_WPO_CONSIDERED,
  VSM_COUNTERS,
  VSM_STATS_WORDS,
} from './constants.ts'
import { vsmBufferGroup, vsmComputePipe, type VsmComputePipe } from './passKit.ts'

/** The most frames one accumulation holds; the frames past it are not kept. */
export const VSM_ACCUMULATE_MAX_FRAMES = 512 * 1024

/** The names of the stats buffer's words, in their order, for the CSV's header. */
export const VSM_STAT_NAMES = (() => {
  const names = new Array<string>(VSM_STATS_WORDS)
  names[VSM_COUNT_WANTED] = 'REQUESTED_THIS_FRAME_PAGES'
  names[VSM_COUNT_STATIC_KEPT] = 'STATIC_CACHED_PAGES'
  names[VSM_COUNT_DYNAMIC_KEPT] = 'DYNAMIC_CACHED_PAGES'
  names[VSM_COUNT_CLEARED] = 'NUM_PAGES_TO_CLEAR'
  names[VSM_COUNT_GRANTED] = 'ALLOCATED_NEW'
  names[VSM_COUNT_EMPTY_PAGES] = 'EMPTY_PAGES'
  names[VSM_COUNT_WPO_CONSIDERED] = 'WPO_CONSIDERED_PAGES'
  names[VSM_COUNTERS] = 'OVERFLOW_FLAGS'
  return names
})()

const PASS_LABEL = `${VSM_PASS_PREFIX}accumulateStats`
const ENTRY = 'vsmAccumulateStats'

/** One thread takes the next row, and copies the frame's stats into it where the row is in room. */
const ACCUMULATE_WGSL = `
@group(0) @binding(0) var<storage,read> frameStats:array<u32>;
@group(0) @binding(1) var<storage,read_write> accumulated:array<atomic<u32>>;
@compute @workgroup_size(1)
fn ${ENTRY}(){
 let slot=atomicAdd(&accumulated[0],1u);
 if(slot>=${VSM_ACCUMULATE_MAX_FRAMES}u){return;}
 let base=1u+slot*${VSM_STATS_WORDS}u;
 for(var k=0u;k<${VSM_STATS_WORDS}u;k++){atomicStore(&accumulated[base+k],frameStats[k]);}
}`

/** The accumulation's progress: the setting last seen, the frames still to take (negative: no end). */
export interface VsmAccumulation {
  asked: number
  left: number
}

/** What a frame does of the accumulation: take a row, finish it, or nothing. */
export type AccumulateStep = 'copy' | 'finish' | 'idle'

/**
 * The step of a frame under `setting` (the progress `state` updated in place). A change of the
 * setting restarts the count (`setting` frames, or no end); 0 finishes a running accumulation, and so
 * does a count that ran out.
 */
export function accumulateStep(
  state: VsmAccumulation,
  setting: number,
  running: boolean,
): AccumulateStep {
  if (setting !== state.asked) {
    state.asked = setting
    state.left = setting
  }
  if (state.left !== 0) {
    if (state.left > 0) state.left--
    return 'copy'
  }
  return running ? 'finish' : 'idle'
}

/** The CSV of the accumulated words `words` (the row count, then the rows): the stat names, then a line a frame. */
export function vsmStatsCsv(words: Uint32Array) {
  const rows = Math.min(words[0], VSM_ACCUMULATE_MAX_FRAMES, (words.length - 1) / VSM_STATS_WORDS)
  const lines = [VSM_STAT_NAMES.join(',')]
  for (let row = 0; row < rows; row++) {
    const at = 1 + row * VSM_STATS_WORDS
    lines.push(Array.from(words.subarray(at, at + VSM_STATS_WORDS)).join(','))
  }
  return lines.join('\n')
}

const GROUPS = [[computeBufferEntry(0, 'read-only-storage'), computeBufferEntry(1, 'storage')]]

/** The accumulation of one set of shadow maps. */
export function createStatsAccumulator(device: GPUDevice) {
  const progress: VsmAccumulation = { asked: 0, left: 0 }
  let pipe: VsmComputePipe | undefined
  let held: { buffer: GPUBuffer; group: GPUBindGroup; rows: number; stats: GPUBuffer } | undefined
  /** The ring of the one readback an accumulation ends with; the tag of a take is the CSV's receiver. */
  const readback = createReadbackRing<(csv: string) => void>(
    device,
    { label: 'vsm.engine.accumulatedStatsReadback', bytes: 4, count: 1 },
    (mapped, _staging, emit) => emit(vsmStatsCsv(new Uint32Array(mapped))),
  )
  /** The row buffer and its group over `stats`, made at the first frame of an accumulation. */
  const hold = (stats: GPUBuffer) => {
    if (held?.stats === stats) return held
    if (held) retire(device, held.buffer)
    const buffer = device.createBuffer({
      label: 'vsm.engine.accumulatedStats',
      size: 4 * (1 + VSM_STATS_WORDS * VSM_ACCUMULATE_MAX_FRAMES),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    pipe ??= vsmComputePipe(device, PASS_LABEL, ACCUMULATE_WGSL, ENTRY, GROUPS)
    const group = vsmBufferGroup(device, pipe.groups[0], [stats, buffer])
    return (held = { buffer, group, rows: 0, stats })
  }
  return {
    /**
     * Records the frame's step under `setting` into `encoder`: the copy of `stats` into the next row, or,
     * the frame the accumulation ends, the copy of its rows to a buffer `afterSubmit` reads; `emit`
     * gets the CSV then.
     */
    encode(
      encoder: GPUCommandEncoder,
      stats: GPUBuffer,
      setting: number,
      emit: (csv: string) => void,
    ) {
      const step = accumulateStep(progress, setting, !!held)
      if (step === 'idle') return
      if (step === 'copy') {
        const rows = hold(stats)
        const compute = pipe!.pipeline
        if (!compute || rows.rows >= VSM_ACCUMULATE_MAX_FRAMES) return
        const pass = encoder.beginComputePass({ label: PASS_LABEL })
        pass.setPipeline(compute)
        pass.setBindGroup(0, rows.group)
        pass.dispatchWorkgroups(1)
        pass.end()
        rows.rows++
        return
      }
      const { buffer, rows } = held!
      const bytes = 4 * (1 + VSM_STATS_WORDS * rows)
      const staging = readback.take(emit, bytes)
      if (!staging) return // the ring is busy: the rows are kept, the next frame finishes
      encoder.copyBufferToBuffer(buffer, 0, staging, 0, bytes)
      retire(device, buffer)
      held = undefined
    },
    /** After the frame's submit: maps the rows the accumulation finished with, which hand out their CSV. */
    afterSubmit: () => readback.submitted(),
    destroy() {
      held?.buffer.destroy()
      held = undefined
      readback.destroy()
    },
  }
}

/** The accumulation of a set (`createStatsAccumulator`). */
export type VsmStatsAccumulator = ReturnType<typeof createStatsAccumulator>
