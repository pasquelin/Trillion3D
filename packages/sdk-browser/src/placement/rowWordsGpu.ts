/**
 * WHAT THE ROWS PASS HOLDS ON THE GPU (`rowWordsPass.ts`): its parameters, the list of the rows the
 * CPU named, a stand-in for each part not made, its two bind groups — the named rows', the composed
 * rows' — and the buffers it last bound, one of which made anew has every row derived.
 */
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { liveBuffer } from '../webgpu/core/liveEntries.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { heldGroup } from './composeGroups.ts'

export function createRowWordsGpu(device: GPUDevice) {
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  return {
    /** The parameters of the named rows' dispatch, then of the composed rows'. */
    params: [0, 1].map(() =>
      device.createBuffer({
        label: 'Trillion3D rows pass params',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    ),
    words: [new Uint32Array(4), new Uint32Array(4)],
    /** The rows the CPU named, sent each frame it named any. */
    list: undefined as GPUBuffer | undefined,
    /** A stand-in for each part whose buffer is not made, and for a list none holds. */
    absent: [0, 1, 2, 3].map(() =>
      device.createBuffer({ label: 'Trillion3D no row part', size: 64, usage: storage }),
    ),
    groups: [heldGroup(), heldGroup()],
    /** What the entries read live, set at each pass, and the buffers the pass last wrote and read:
     *  one of them made anew has every row derived. */
    frame: [undefined, undefined, undefined] as (GPUBuffer | undefined)[],
    named: new Array<GPUBuffer | undefined>(7),
    next: new Array<GPUBuffer | undefined>(7),
  }
}
export type RowWordsGpu = ReturnType<typeof createRowWordsGpu>

/** The pass's entries for its dispatch `g` (`DERIVE_ROWS_WGSL`), read live. */
export const rowEntries = (rt: WebgpuPagesRuntime, gpu: RowWordsGpu, g: number) =>
  sequentialEntries([
    liveBuffer(
      () => gpu.params[g],
      undefined,
      () => 16,
    ),
    liveBuffer(() => rt.rootWorlds!.worlds),
    liveBuffer(() => rt.vis.pageTable),
    liveBuffer(() => gpu.frame[0] ?? gpu.absent[0]),
    liveBuffer(() => rt.rowWords!.inputs.buffer),
    liveBuffer(() => rt.rootWorlds!.boxes),
    liveBuffer(() => gpu.frame[1] ?? gpu.absent[1]),
    liveBuffer(() => gpu.frame[2] ?? gpu.absent[2]),
    liveBuffer(() => (g ? rt.compose?.gpu?.rowList : gpu.list) ?? gpu.absent[3]),
  ])

/** Whether a buffer the pass writes or reads is another than at its last run: the table, the
 *  inputs, the worlds and their boxes, then the parts. */
export function partsMoved(rt: WebgpuPagesRuntime, gpu: RowWordsGpu) {
  const { named, next } = gpu
  next[0] = rt.vis.pageTable
  next[1] = rt.rowWords!.inputs.buffer
  next[2] = rt.rootWorlds!.worlds
  next[3] = rt.rootWorlds!.boxes
  for (let k = 0; k < 3; k++) next[4 + k] = gpu.frame[k]
  let moved = false
  for (let k = 0; k < next.length; k++) {
    if (named[k] !== next[k]) moved = true
    named[k] = next[k]
  }
  return moved
}

/** The pass's buffers and the rows' inputs, destroyed with the session. */
export function disposeRowWords(rt: WebgpuPagesRuntime) {
  const state = rt.rowWords
  if (!state) return
  state.inputs.buffer?.destroy()
  const gpu = state.gpu
  for (const buffer of [...(gpu?.params ?? []), ...(gpu?.absent ?? []), gpu?.list])
    buffer?.destroy()
  rt.rowWords = undefined
}
