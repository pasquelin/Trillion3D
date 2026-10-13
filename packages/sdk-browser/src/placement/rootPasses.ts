/**
 * WHAT A SESSION WRITES OF ITS ROOTS ON THE GPU BEFORE EVERY CUT (`RootsOnGpu`,
 * `../gpu/dag/runtime.ts`): the worlds the host moved, sent (`rootWorlds.ts`); the composition's
 * passes, a composed world multiplied once (`gpuComposeEncode.ts`); the moved roots' world boxes and
 * stretches (`rootBoxes.ts`) — in a command buffer of their own, submitted at once, timed with the
 * image it goes before —; then the tree's leaves, in the refit's (`treeLeaves.ts`), which follows. Each reads what the one before it
 * wrote, in the queue's order: the CPU never waits on the GPU, and no pass composes a world again.
 * The cut, and the frame's rows pass after it, read every word of them.
 */
import type { RootsOnGpu } from '../gpu/dag/runtime.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { COMPOSED, ENCODED, encodeComposedRoots } from './gpuComposeEncode.ts'
import { encodeRootBoxes, rootBoxesKernel } from './rootBoxes.ts'
import { sendRootWorlds } from './rootWorlds.ts'
import { leafKernels, treeLeaves } from './treeLeaves.ts'
import { createImagePart } from '../webgpu/pages/render/encoder.ts'

/** Runtime `rt`'s roots brought level on the GPU — the composition's passes first when `compose` —,
 *  their own command buffer submitted when it holds a pass: nothing in a frame where nothing moved
 *  since the last time. */
function writeRoots(rt: WebgpuPagesRuntime, compose: boolean) {
  const device = rt.gpu.device
  if (!device || rt.run.lost) return
  sendRootWorlds(rt, device)
  // Nothing to compose and no root moved: no command buffer.
  const moved = rt.rootWorlds!.roots
  if (!(compose && rt.compose?.parentIds.size) && !moved.whole && !moved.count) return
  // A part of the image it goes before, timed with it (`createImagePart`); a cut no image follows
  // (a waiting selection's) times nothing.
  const encoder = rt.timing.frameEncoder
    ? createImagePart(rt, device)
    : device.createCommandEncoder({ label: 'Trillion3D roots' })
  const done = compose ? encodeComposedRoots(rt, device, encoder) : 0
  const boxed = encodeRootBoxes(rt, device, encoder, (done & COMPOSED) !== 0)
  if (boxed || done & ENCODED) device.queue.submit([encoder.finish()])
}

/** The roots on the GPU of runtime `rt`, as every cut of its session writes them first. */
export const rootsOnGpu = (rt: WebgpuPagesRuntime): RootsOnGpu => ({
  roots: () => writeRoots(rt, true),
  leaves: treeLeaves(rt),
})

/** The worlds the host moved since the cut last wrote the roots, their boxes and stretches with
 *  them, before the rows pass reads the boxes (`rowWordsPass.ts`): what an image no cut ran before
 *  still owes. The composition is the cut's alone. */
export const writeMovedRoots = (rt: WebgpuPagesRuntime) => writeRoots(rt, false)

/** Asks the kernels the roots' passes bind at a frame's entry (`../webgpu/frame/framePipelines.ts`):
 *  the root boxes pass once there is a root, the tree's leaves once its cut has a tree. */
export function askRootPasses(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.layout.selectionRoots.length) return
  rootBoxesKernel(device).ask()
  const nodes = rt.run.gpuSelection?.treeNodes
  if (nodes) leafKernels(device).of(nodes).ask()
}
