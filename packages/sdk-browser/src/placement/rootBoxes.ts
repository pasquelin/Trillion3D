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
import { preparedComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { liveBuffer, resourceEntry } from '../webgpu/core/liveEntries.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { ROOT_BOXES_PASS } from '../stage/passLabels.ts'
import { composeGroup, heldGroup, type HeldGroup } from './composeGroups.ts'
import { PASS_PARAM_BYTES, passParams, writePassParams } from './gpuComposeGpu.ts'
import { takeMovedRoots } from './rootMoves.ts'
import { ROOT_BOXES_ENTRY, ROOT_BOXES_FRAMES_BINDING, ROOT_BOXES_WGSL } from './rootBoxesWgsl.ts'

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
    params: [passParams('Trillion3D root boxes params'), passParams('Trillion3D root boxes')],
    /** The moved roots, sent each time the pass runs over a list. */
    list: undefined as GPUBuffer | undefined,
    /** The list a dispatch over every root binds: it reads none. */
    absent: device.createBuffer({
      label: 'Trillion3D no root list',
      size: 16,
      usage: GPUBufferUsage.STORAGE,
    }),
    /** The group of each dispatch: the moved roots', the composed roots'. */
    groups: [heldGroup(), heldGroup()] as HeldGroup[],
    /** The cut's frame words while the pass binds them. */
    frames: undefined as GPUTextureView | undefined,
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

/** The entries of dispatch `g` (`ROOT_BOXES_WGSL`), read live. */
const entries = (rt: WebgpuPagesRuntime, gpu: RootBoxesGpu, g: number) => [
  ...sequentialEntries([
    liveBuffer(
      () => gpu.params[g].buffer,
      undefined,
      () => PASS_PARAM_BYTES,
    ),
    liveBuffer(() => rt.rootWorlds?.worlds),
    liveBuffer(() => rt.rootWorlds?.locals),
    liveBuffer(() => rt.rootWorlds?.boxes),
    liveBuffer(() => (g ? rt.compose?.gpu?.rankList : gpu.list) ?? gpu.absent),
  ]),
  resourceEntry(ROOT_BOXES_FRAMES_BINDING, () => gpu.frames),
]

/** The moved roots `ranks`, sent; a list made again when they outgrow it. */
function sendList(device: GPUDevice, gpu: RootBoxesGpu, ranks: Int32Array<ArrayBuffer>) {
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

/** Dispatch `g` of the pass into `pass`: `listed` roots, every root when `whole`. */
function dispatch(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  { g, listed, whole }: { g: number; listed: number; whole: boolean },
) {
  const gpu = rt.rootBoxes!,
    pipeline = rootBoxesKernel(device).get(),
    held = gpu.groups[g]
  writePassParams(device, gpu.params[g], rt.rootWorlds!.held, listed, whole ? 1 : 0)
  pass.setPipeline(pipeline)
  held.identity.entries[0] ??= entries(rt, gpu, g)
  composeGroup(device, held, pipeline)
  pass.setBindGroup(0, held.group!)
  dispatchRows(pass, ceilDiv(listed, WORKGROUP_THREADS))
  rt.run.gpuComputeDispatches++
}

/**
 * The world boxes and stretches of the roots whose world moved, into `encoder`, their stretches into
 * `frames`, the cut's frame words: the roots a send moved or made — those a cut took in place
 * before they join included (`rootWorlds.ts`) —, or every root, then the composed roots when the
 * compose worlds pass `composed` them anew (a dispatch over every root holds them already). Whether
 * it encoded anything; nothing while the cut or the worlds are not made — the roots wait for the
 * pass, kept in their list.
 */
export function encodeRootBoxes(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  { composed, frames }: { composed: boolean; frames: GPUTextureView | undefined },
) {
  const held = rt.rootWorlds
  if (!held?.worlds || !frames) return false
  const listedComposed = composed ? (rt.compose?.rankList.set.count ?? 0) : 0
  if (!held.roots.whole && !held.roots.count && !listedComposed) return false
  const named = takeMovedRoots(held),
    listed = named ? named.length : held.held
  const gpu = (rt.rootBoxes ??= createRootBoxesGpu(device))
  if (named?.length) sendList(device, gpu, named)
  gpu.frames = frames
  const pass = encoder.beginComputePass({ label: ROOT_BOXES_PASS })
  if (listed) dispatch(rt, device, pass, { g: 0, listed, whole: !named })
  if (named && listedComposed)
    dispatch(rt, device, pass, { g: 1, listed: listedComposed, whole: false })
  pass.end()
  gpu.frames = undefined
  return true
}
