/**
 * THE COMPOSITION'S FRAME (`gpuCompose.ts`): its kernels, asked off the thread, and the links, the
 * parents' worlds sent once a frame, each only when it moved.
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { packDoubles, PACKED_MATRIX_WORDS } from '../../../../math/src/float/splitDouble.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_ENTRY, COMPOSE_WORLDS_WGSL } from './gpuComposeWgsl.ts'
import type { ComposeState } from './gpuComposeState.ts'
import { createComposeGpu, type ComposeGpu } from './gpuComposeGpu.ts'
import { writeBufferRuns } from '../../geometry/dag/runWrites.ts'

/** The worlds' and the roots' kernels, once a device, compiled off the thread: asked at a frame's
 *  entry once a parent holds a link (`askComposedPlacements`), the frames held until they landed,
 *  so the frame that composes binds them compiled. */
export const composeKernels = {
  roots: autoKernel('Trillion3D compose roots', COMPOSE_ROOTS_WGSL, 'main'),
  worlds: autoKernel('Trillion3D compose worlds', COMPOSE_WORLDS_WGSL, COMPOSE_WORLDS_ENTRY),
}

/** Asks the kernels the next frame binds once a parent holds a link
 *  (`../../frame/loop/framePipelines.ts`); nothing while none does. */
export function askComposedPlacements(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.compose?.parentIds.size) return
  composeKernels.roots(device).ask()
  composeKernels.worlds(device).ask()
}

/** Slot `p`'s world packed in doubles. */
const packParent = (state: ComposeState, p: number) =>
  packDoubles(state.packed, p * PACKED_MATRIX_WORDS, state.worlds, p * MATRIX_VALUES, MATRIX_VALUES)

/** The parents' worlds set since they last went up, packed and sent in runs — every one into a
 *  buffer made anew (`whole`). */
function writeParents(device: GPUDevice, gpu: ComposeGpu, state: ComposeState, whole: boolean) {
  const count = state.slots,
    moved = state.parentsMoved
  if (!whole && !moved.count) return
  state.packed = resized(state.packed, count * PACKED_MATRIX_WORDS)
  if (whole) {
    moved.clear()
    for (let p = 0; p < count; p++) packParent(state, p)
    device.queue.writeBuffer(gpu.parents!, 0, state.packed, 0, count * PACKED_MATRIX_WORDS)
    return
  }
  const slots = moved.take()
  for (let k = 0; k < slots.length; k++) packParent(state, slots[k])
  writeBufferRuns(device, gpu.parents!, slots, slots.length, state.packed, PACKED_MATRIX_WORDS)
}

/** The links moved since they last went up, sent in runs: the local matrix and the parent of each
 *  root whose link moved — every root's into tables made anew (`fresh`). Whether any went up. */
function writeLinks(device: GPUDevice, gpu: ComposeGpu, state: ComposeState, fresh: boolean) {
  const moved = state.linksMoved
  if (fresh) {
    moved.clear()
    // The tables are the capacity (`resized`): the roots' words alone go up.
    const roots = Math.max(1, state.roots)
    device.queue.writeBuffer(gpu.locals, 0, state.locals, 0, roots * PACKED_MATRIX_WORDS)
    device.queue.writeBuffer(gpu.parentOf, 0, state.parentOf, 0, roots)
    return true
  }
  if (!moved.count) return false
  const ranks = moved.take()
  writeBufferRuns(device, gpu.locals, ranks, ranks.length, state.locals, PACKED_MATRIX_WORDS)
  writeBufferRuns(device, gpu.parentOf, ranks, ranks.length, state.parentOf, 1)
  return true
}

/** The links and this frame's parents on the GPU, each sent once per frame and only what moved;
 *  undefined without links. What the passes compose moved, its version moves (`composedAt`). */
export function frameParents(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = rt.compose
  if (!state || !state.parentIds.size) return undefined
  const fresh = !state.gpu,
    gpu = (state.gpu ??= createComposeGpu(device, state.roots))
  if (state.frame === rt.run.frame) return gpu
  state.frame = rt.run.frame
  const linked = writeLinks(device, gpu, state, fresh)
  // Room for the parents to come before it is made again (`sizedBuffer`): what it held is sent
  // again whole.
  const held = gpu.parents
  gpu.parents = sizedBuffer(
    device,
    held,
    state.slots * PACKED_MATRIX_WORDS * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    'Trillion3D composed parent worlds',
  )
  const made = gpu.parents !== held
  writeParents(device, gpu, state, made)
  // Tables made anew hold no composed world: every composed root is composed again.
  if (fresh || made) state.composed.whole = true
  // Whether a parent moved, as its settle found it (`settleSlot`), or a link went up — a local
  // moved its root with no parent's move —: the frame takes it, and the cut cuts again under it.
  state.moving = state.movedSince || linked
  state.movedSince = false
  const composing = state.composed.whole || state.composed.ranks.count > 0
  if (state.moving || linked || composing) state.composedAt++
  return gpu
}
