/**
 * THE COMPOSITION'S FRAME (`gpuCompose.ts`): its kernels, asked off the thread, and the links, the
 * parents' worlds and the composed roots' list sent once a frame, each only when it moved.
 */
import { resized } from '../../../math/src/sequence/resized.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { preparedComputePipeline } from '../lighting/deferred/fullscreen.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import {
  COMPOSE_ROOTS_WGSL,
  COMPOSE_WORLDS_ENTRY,
  COMPOSE_WORLDS_WGSL,
  MATRIX_DOUBLES,
} from './gpuComposeWgsl.ts'
import { sendList } from './composedRows.ts'
import type { ComposeState } from './gpuComposeState.ts'
import { createComposeGpu } from './gpuComposeGpu.ts'

/** The worlds' and the roots' kernels, once a device, compiled off the thread: asked at a frame's
 *  entry once a parent holds a link (`askComposedPlacements`), the frames held until they landed,
 *  so the frame that composes binds them compiled. */
export const composeKernels = oncePerDevice((device) => {
  const kernel = (module: GPUShaderModule, entryPoint = 'main') =>
    preparedComputePipeline(device, {
      label: module.label,
      layout: 'auto',
      compute: { module, entryPoint },
    })
  return {
    roots: kernel(
      device.createShaderModule({ label: 'Trillion3D compose roots', code: COMPOSE_ROOTS_WGSL }),
    ),
    worlds: kernel(
      device.createShaderModule({ label: 'Trillion3D compose worlds', code: COMPOSE_WORLDS_WGSL }),
      COMPOSE_WORLDS_ENTRY,
    ),
  }
})

/** Asks the kernels the next frame binds once a parent holds a link
 *  (`../webgpu/frame/framePipelines.ts`); nothing while none does. */
export function askComposedPlacements(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.compose?.parentIds.size) return
  const kernels = composeKernels(device)
  kernels.roots.ask()
  kernels.worlds.ask()
}

/** Parent matrices for this frame, each world in doubles, packed when one was set since they last
 *  went up; notes whether one moved since the last frame. */
function writeParents(state: ComposeState) {
  state.moving = false
  if (!state.parentsDirty) return false
  const count = state.slots
  state.packed = resized(state.packed, count * MATRIX_DOUBLES * 2)
  const { worlds, previous } = state
  for (let p = 0; p < count; p++) {
    const at = p * 16
    packDoubles(state.packed, p * MATRIX_DOUBLES * 2, worlds, at, 16)
    for (let k = at; k < at + 16; k++)
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
    device.queue.writeBuffer(gpu.locals, 0, state.locals, 0, roots * MATRIX_DOUBLES * 2)
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
  const made = !gpu.parents || gpu.parents.size < count * MATRIX_DOUBLES * 8
  if (made) {
    gpu.parents?.destroy()
    gpu.parents = device.createBuffer({
      label: 'Trillion3D composed parent worlds',
      size: count * MATRIX_DOUBLES * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    state.parentsDirty = true
  }
  if (writeParents(state))
    device.queue.writeBuffer(gpu.parents!, 0, state.packed, 0, count * MATRIX_DOUBLES * 2)
  if (state.moving || linked || seeded || made) state.composedAt++
  return gpu
}
