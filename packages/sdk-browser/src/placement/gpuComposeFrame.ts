/**
 * THE COMPOSITION'S FRAME (`gpuCompose.ts`): its kernels, asked off the thread, and the links, the
 * parents' worlds and the composed roots' list sent once a frame, each only when it moved.
 */
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { packDoubles, PACKED_MATRIX_WORDS } from '../../../math/src/float/splitDouble.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { sizedBuffer } from '../gpu/core/sizedBuffer.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_ENTRY, COMPOSE_WORLDS_WGSL } from './gpuComposeWgsl.ts'
import { sendList } from './composedRows.ts'
import type { ComposeState } from './gpuComposeState.ts'
import { createComposeGpu } from './gpuComposeGpu.ts'
import { COMPOSE_MOTION_ENTRY, COMPOSE_MOTION_WGSL } from './composedMotionWgsl.ts'

/** The worlds', the roots' and the motion's kernels, once a device, compiled off the thread: asked at a frame's
 *  entry once a parent holds a link (`askComposedPlacements`), the frames held until they landed,
 *  so the frame that composes binds them compiled. */
export const composeKernels = {
  roots: autoKernel('Trillion3D compose roots', COMPOSE_ROOTS_WGSL, 'main'),
  worlds: autoKernel('Trillion3D compose worlds', COMPOSE_WORLDS_WGSL, COMPOSE_WORLDS_ENTRY),
  motion: autoKernel('Trillion3D compose motion', COMPOSE_MOTION_WGSL, COMPOSE_MOTION_ENTRY),
}

/** Asks the kernels the next frame binds once a parent holds a link
 *  (`../webgpu/frame/framePipelines.ts`); nothing while none does. */
export function askComposedPlacements(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.compose?.parentIds.size) return
  composeKernels.roots(device).ask()
  composeKernels.worlds(device).ask()
  composeKernels.motion(device).ask()
}

/** Parent matrices for this frame, each world in doubles, packed when one was set since they last
 *  went up; notes whether one moved since the last frame. */
function writeParents(state: ComposeState) {
  state.moving = false
  if (!state.parentsDirty) return false
  const count = state.slots
  state.packed = resized(state.packed, count * PACKED_MATRIX_WORDS)
  const { worlds, previous } = state
  for (let p = 0; p < count; p++) {
    const at = p * MATRIX_VALUES
    packDoubles(state.packed, p * PACKED_MATRIX_WORDS, worlds, at, MATRIX_VALUES)
    for (let k = at; k < at + MATRIX_VALUES; k++)
      if (previous[k] !== worlds[k]) {
        state.moving = true
        previous[k] = worlds[k]
      }
  }
  state.parentsDirty = false
  return true
}

/** The links, this frame's parents and the list of composed roots on the GPU, each sent once per
 *  frame and only when it moved; undefined without links. What the passes compose moved, its
 *  version moves (`composedAt`). */
export function frameParents(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = rt.compose
  if (!state || !state.parentIds.size) return undefined
  const fresh = !state.gpu,
    gpu = (state.gpu ??= createComposeGpu(device, state.roots))
  if (state.frame === rt.run.frame) return gpu
  state.frame = rt.run.frame
  // The roots pass names the motion buffer it binds, on the frames it runs.
  state.motionBound = undefined
  const linked = state.linksDirty || fresh
  if (linked) {
    // The tables are the capacity (`resized`): the roots' words alone go up.
    const roots = Math.max(1, state.roots)
    device.queue.writeBuffer(gpu.locals, 0, state.locals, 0, roots * PACKED_MATRIX_WORDS)
    device.queue.writeBuffer(gpu.parentOf, 0, state.parentOf, 0, roots)
    state.linksDirty = false
  }
  const seeded = state.seeds.size > 0
  for (const [rank, pose] of state.seeds) device.queue.writeBuffer(gpu.previous, rank * 64, pose)
  state.seeds.clear()
  // The list of composed roots: on a fresh table whole, else its places moved since.
  if (fresh) state.rankList.moves.clear()
  gpu.rankList = sendList(
    device,
    fresh ? undefined : gpu.rankList,
    'Trillion3D composed roots',
    state.rankList,
  )
  const count = state.slots
  // Room for the parents to come before it is made again (`sizedBuffer`): what it held is sent
  // again whole.
  const held = gpu.parents
  gpu.parents = sizedBuffer(
    device,
    held,
    count * PACKED_MATRIX_WORDS * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    'Trillion3D composed parent worlds',
  )
  const made = gpu.parents !== held
  if (made) state.parentsDirty = true
  if (writeParents(state))
    device.queue.writeBuffer(gpu.parents, 0, state.packed, 0, count * PACKED_MATRIX_WORDS)
  if (state.moving || linked || seeded || made) state.composedAt++
  return gpu
}
