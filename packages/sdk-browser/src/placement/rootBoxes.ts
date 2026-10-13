/**
 * THE ROOT BOXES PASS ON THE GPU (`rootBoxesWgsl.ts`): each root whose world moved has its world box
 * and its stretch derived from the world the GPU holds — the roots a send moved (`takeMovedRoots`),
 * every root after a whole send, and the roots a parent composes once the compose worlds pass wrote
 * their worlds anew. It runs in the roots' command buffer before every cut (`rootPasses.ts`), after
 * the composition's passes: the cut reads the stretches, the rows pass the boxes. A move costs the
 * CPU no box and no stretch, and the list of the roots it moved alone.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { grownLength } from '../../../math/src/sequence/resized.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { PRIMITIVE_BYTES } from '../gpu/dag/cameraRanges.ts'
import { preparedComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { uniformStride } from '../residency/pools.ts'
import { liveBuffer } from '../webgpu/core/liveEntries.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { ROOT_BOXES_PASS } from '../stage/passLabels.ts'
import { composeGroup, heldGroup, type HeldGroup } from './composeGroups.ts'
import { NO_RANGES, rangeParams, writeRangeParams } from './gpuComposeGpu.ts'
import { takeMovedRoots } from './rootMoves.ts'
import { ROOT_BOXES_ENTRY, ROOT_BOXES_PARAM_WORDS, ROOT_BOXES_WGSL } from './rootBoxesWgsl.ts'

/** The pass's kernel, once a device, compiled off the thread (`askRootPasses`). */
export const rootBoxesKernel = oncePerDevice((device) =>
  preparedComputePipeline(device, {
    label: ROOT_BOXES_PASS,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ label: ROOT_BOXES_PASS, code: ROOT_BOXES_WGSL }),
      entryPoint: ROOT_BOXES_ENTRY,
    },
  }),
)

function createRootBoxesGpu(device: GPUDevice) {
  return {
    /** The parameters of the moved roots' dispatches, then of the composed roots'. */
    params: [rangeParams('Trillion3D root boxes params'), rangeParams('Trillion3D root boxes')],
    /** The moved roots, sent each time the pass runs over a list. */
    list: undefined as GPUBuffer | undefined,
    /** The list a dispatch over every root binds: it reads none. */
    absent: device.createBuffer({
      label: 'Trillion3D no root list',
      size: 16,
      usage: GPUBufferUsage.STORAGE,
    }),
    /** The group of each dispatch — the moved roots', the composed roots' — over each range. */
    groups: [[], []] as HeldGroup[][],
    /** The cut's world ranges while the pass binds them. */
    ranges: NO_RANGES,
  }
}
export type RootBoxesGpu = ReturnType<typeof createRootBoxesGpu>

/** The pass's buffers, destroyed with the session. */
export function disposeRootBoxes(rt: Pick<WebgpuPagesRuntime, 'rootBoxes'>) {
  const gpu = rt.rootBoxes
  if (!gpu) return
  for (const buffer of [gpu.list, gpu.absent, ...gpu.params.map((p) => p.buffer)]) buffer?.destroy()
  rt.rootBoxes = undefined
}

/** The entries of dispatch `g` over range `r` (`ROOT_BOXES_WGSL`), read live. */
const entries = (
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  gpu: RootBoxesGpu,
  g: number,
  r: number,
) =>
  sequentialEntries([
    liveBuffer(
      () => gpu.params[g].buffer,
      () => r * uniformStride(device.limits),
      () => ROOT_BOXES_PARAM_WORDS * 4,
    ),
    liveBuffer(() => rt.rootWorlds?.worlds),
    liveBuffer(() => rt.rootWorlds?.locals),
    liveBuffer(() => rt.rootWorlds?.boxes),
    liveBuffer(
      () => gpu.ranges[r].frames,
      undefined,
      () => gpu.ranges[r].count * PRIMITIVE_BYTES,
    ),
    liveBuffer(() => (g ? rt.compose?.gpu?.rankList : gpu.list) ?? gpu.absent),
  ])

/** The moved roots `ranks`, sent; a list made again when they outgrow it. */
function sendList(device: GPUDevice, gpu: RootBoxesGpu, ranks: Int32Array) {
  if (!gpu.list || gpu.list.size < ranks.byteLength) {
    gpu.list?.destroy()
    gpu.list = device.createBuffer({
      label: 'Trillion3D moved roots',
      size: grownLength(gpu.list ? gpu.list.size : 0, ranks.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }
  device.queue.writeBuffer(gpu.list, 0, ranks)
}

/** Dispatch `g` of the pass into `pass`, over every range: `listed` roots, every root when
 *  `whole`. */
function dispatch(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  { g, listed, whole }: { g: number; listed: number; whole: boolean },
) {
  const gpu = rt.rootBoxes!,
    ranges = gpu.ranges,
    pipeline = rootBoxesKernel(device).get()
  writeRangeParams(device, gpu.params[g], ranges, rt.rootWorlds!.sent, listed, whole ? 1 : 0)
  pass.setPipeline(pipeline)
  for (let r = 0; r < ranges.length; r++) {
    const held = (gpu.groups[g][r] ??= heldGroup())
    held.identity.entries[0] ??= entries(rt, device, gpu, g, r)
    composeGroup(device, held, pipeline)
    pass.setBindGroup(0, held.group!)
    dispatchRows(pass, ceilDiv(listed, WORKGROUP_THREADS))
  }
  rt.run.gpuComputeDispatches += ranges.length
}

/**
 * The world boxes and stretches of the roots whose world moved, into `encoder`: the roots a send
 * moved, or every root, then the composed roots when the compose worlds pass `composed` them anew
 * (a dispatch over every root holds them already). Whether it encoded anything; nothing while the
 * cut or the worlds are not made — the roots wait for the pass, kept in their list.
 */
export function encodeRootBoxes(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  composed: boolean,
) {
  const held = rt.rootWorlds,
    selection = rt.run.gpuSelection
  if (!held?.worlds || !selection) return false
  const listedComposed = composed ? (rt.compose?.rankList.set.count ?? 0) : 0
  if (!held.roots.whole && !held.roots.count && !listedComposed) return false
  const named = takeMovedRoots(held),
    listed = named ? named.length : held.sent
  const gpu = (rt.rootBoxes ??= createRootBoxesGpu(device))
  if (named?.length) sendList(device, gpu, named)
  gpu.ranges = selection.worldRanges
  const pass = encoder.beginComputePass({ label: ROOT_BOXES_PASS })
  if (listed) dispatch(rt, device, pass, { g: 0, listed, whole: !named })
  if (named && listedComposed)
    dispatch(rt, device, pass, { g: 1, listed: listedComposed, whole: false })
  pass.end()
  gpu.ranges = NO_RANGES
  return true
}
