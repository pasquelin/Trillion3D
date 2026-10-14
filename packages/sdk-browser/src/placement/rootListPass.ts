/**
 * THE PASSES OVER LISTED ROOTS (`rootBoxes.ts`, `treeLeaves.ts`): one kernel in two dispatches — the
 * roots a list names, or every root, then the roots a parent composes (`rankList`) —, each with its
 * parameters (`passParams`) and its group, the list sent and a stand-in for it. With them, the one
 * way a placement pass sends a list of words (`sendWords`) and dispatches a thread an entry of it
 * (`dispatchGroup`).
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { sizedBuffer } from '../gpu/core/sizedBuffer.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { liveBuffer } from '../webgpu/core/liveEntries.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { composeGroup, heldGroup, type HeldGroup } from '../webgpu/core/bindIdentity.ts'
import { PASS_PARAM_BYTES, passParams, writePassParams } from '../gpu/core/passParams.ts'

/** The first `count` words of `words` into `held`, made again when they outgrow it
 *  (`sizedBuffer`): the buffer that holds them. */
export function sendWords(
  device: GPUDevice,
  held: GPUBuffer | undefined,
  words: Uint32Array<ArrayBuffer> | Int32Array<ArrayBuffer>,
  count: number,
  label: string,
) {
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    buffer = sizedBuffer(device, held, count * 4, usage, label)
  device.queue.writeBuffer(buffer, 0, words, 0, count)
  return buffer
}

/** `held`'s group bound into `pass`, its pipeline set, a thread each of `listed` entries. */
export function dispatchGroup(
  rt: WebgpuPagesRuntime,
  pass: GPUComputePassEncoder,
  held: HeldGroup,
  listed: number,
) {
  pass.setBindGroup(0, held.group!)
  dispatchRows(pass, ceilDiv(listed, WORKGROUP_THREADS))
  rt.run.gpuComputeDispatches++
}

/** A pass over listed roots: its two dispatches' parameters and groups — dispatch `g`'s over
 *  `entries(list, g)` (`rootListEntries`) —, the list of the roots named and the stand-in a
 *  dispatch over every root binds. */
export type RootList = {
  entries: (list: RootList, g: number) => GPUBindGroupEntry[]
  listLabel: string
  params: ReturnType<typeof passParams>[]
  list: GPUBuffer | undefined
  absent: GPUBuffer
  groups: HeldGroup[]
}

/** The pass over listed roots labelled `label`, its groups over `entries`. */
export function createRootList(
  device: GPUDevice,
  label: string,
  entries: RootList['entries'],
): RootList {
  return {
    entries,
    listLabel: `${label} list`,
    params: [passParams(`${label} params`), passParams(`${label} composed params`)],
    list: undefined,
    absent: device.createBuffer({
      label: `${label} no list`,
      size: 16,
      usage: GPUBufferUsage.STORAGE,
    }),
    groups: [heldGroup(), heldGroup()],
  }
}

/** The first `count` roots of `ranks` named to the pass's first dispatch. */
export function sendRootList(
  device: GPUDevice,
  list: RootList,
  ranks: Int32Array<ArrayBuffer>,
  count: number,
) {
  list.list = sendWords(device, list.list, ranks, count, list.listLabel)
}

/** The pass's buffers, destroyed with the session. */
export function disposeRootList(list: RootList) {
  for (const buffer of [list.list, list.absent, ...list.params.map((p) => p.buffer)])
    buffer?.destroy()
}

/** The entries of dispatch `g`, read live: its parameters, then `reads`, then its list — the roots
 *  named, or the composed roots'. */
export const rootListEntries = (
  rt: WebgpuPagesRuntime,
  list: RootList,
  g: number,
  reads: readonly GPUBufferBinding[],
) =>
  sequentialEntries([
    liveBuffer(
      () => list.params[g].buffer,
      undefined,
      () => PASS_PARAM_BYTES,
    ),
    ...reads,
    liveBuffer(() => (g ? rt.compose?.gpu?.rankList : list.list) ?? list.absent),
  ])

/** Dispatch `g` of `pipeline` into `pass` (its pipeline set): `listed` of `roots` roots, every
 *  root when `whole`, its group made once. */
export function dispatchRootList(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  list: RootList,
  g: number,
  roots: number,
  listed: number,
  whole: boolean,
) {
  const held = list.groups[g]
  writePassParams(device, list.params[g], roots, listed, whole ? 1 : 0)
  held.identity.entries[0] ??= list.entries(list, g)
  composeGroup(device, held, pipeline)
  dispatchGroup(rt, pass, held, listed)
}
