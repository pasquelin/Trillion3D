/**
 * WHAT A SESSION WRITES OF ITS ROOTS ON THE GPU BEFORE EVERY CUT (`RootsOnGpu`,
 * `../gpu/dag/runtime.ts`): the worlds the host moved, sent (`rootWorlds.ts`); the composition's
 * passes, a composed world multiplied once (`gpuComposeEncode.ts`), and the moved roots' world
 * boxes and stretches (`rootBoxes.ts`), in one compute pass whose command buffer is submitted at
 * once, timed with the image it goes before; then the tree's leaves, in the refit's
 * (`treeLeaves.ts`), which follows. Each reads what the one before it wrote — a dispatch sees the
 * storage an earlier one of its pass wrote, the queue's order the rest —: the CPU never waits on
 * the GPU, and no pass composes a world again. The cut, and the frame's rows pass after it, read
 * every word of them.
 */
import type { RootsOnGpu } from '../gpu/dag/runtimeOps.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { LazyComputePass } from '../gpu/core/lazyComputePass.ts'
import { COMPOSE_ROOTS_PASS } from '../stage/passLabels.ts'
import { encodeComposedRoots } from './gpuComposeEncode.ts'
import { encodeRootBoxes, rootBoxesKernel } from './rootBoxes.ts'
import { sendRootWorlds } from './rootWorlds.ts'
import { leafKernel, treeLeaves } from './treeLeaves.ts'
import { createImagePart } from '../webgpu/pages/render/encoder.ts'

/**
 * Runtime `rt`'s roots' one compute pass, held with its root worlds (`RootWorlds.pass`), made once:
 * opened by the first pass that runs, its command buffer made then — a frame where nothing moved
 * since the last time makes none —, a part of the image it goes before, timed with it
 * (`createImagePart`); a cut no image follows (a waiting selection's) times nothing. Submitted at
 * once, never in the frame's command buffer: a second cut of the frame rewrites the passes'
 * parameters, and an image dropped would drop the roots it took.
 */
function rootsPassOf(rt: WebgpuPagesRuntime) {
  return (rt.rootWorlds!.pass ??= {
    open: new LazyComputePass(COMPOSE_ROOTS_PASS),
    encoder: () => {
      const device = rt.gpu.device!
      return rt.timing.frameEncoder
        ? createImagePart(rt, device)
        : device.createCommandEncoder({ label: 'Trillion3D roots' })
    },
  })
}

/** Runtime `rt`'s roots brought level on the GPU — the composition's passes first when `compose` —,
 *  their stretches into `frames`, the frame words of the cut they go before. */
function writeRoots(rt: WebgpuPagesRuntime, compose: boolean, frames: GPUTextureView | undefined) {
  const device = rt.gpu.device
  if (!device || rt.run.lost) return
  sendRootWorlds(rt, device)
  const held = rootsPassOf(rt),
    open = held.open.begin(held.encoder)
  const composed = compose && encodeComposedRoots(rt, device, open)
  encodeRootBoxes(rt, device, open, composed, frames)
  const encoder = open.end()
  if (encoder) device.queue.submit([encoder.finish()])
}

/** The roots on the GPU of runtime `rt`, as every cut of its session writes them first. */
export const rootsOnGpu = (rt: WebgpuPagesRuntime): RootsOnGpu => ({
  roots: (frames) => writeRoots(rt, true, frames.view),
  leaves: treeLeaves(rt),
})

/** The worlds the host moved since the cut last wrote the roots, their boxes and stretches with
 *  them, before the rows pass reads the boxes (`rowWordsPass.ts`): what an image no cut ran before
 *  still owes. The composition is the cut's alone. */
export const writeMovedRoots = (rt: WebgpuPagesRuntime) =>
  writeRoots(rt, false, rt.run.gpuSelection?.frames)

/** Asks the kernels the roots' passes bind at a frame's entry (`../webgpu/frame/framePipelines.ts`):
 *  the root boxes pass once there is a root, the tree's leaves once its cut has a tree. */
export function askRootPasses(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.layout.selectionRoots.length) return
  rootBoxesKernel(device).ask()
  if (rt.run.gpuSelection?.treeFollowed) leafKernel(device).ask()
}
