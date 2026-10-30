/**
 * WHAT A SESSION WRITES OF ITS ROOTS ON THE GPU BEFORE EVERY CUT (`RootsOnGpu`,
 * `../../geometry/dag/runtime/runtime.ts`): the worlds the host moved, sent (`rootWorlds.ts`); the composition's
 * passes, a composed world multiplied once (`../compose/gpuComposeEncode.ts`), and the moved roots' world
 * boxes and stretches (`rootBoxes.ts`), in one compute pass whose command buffer is submitted at
 * once, timed with the image it goes before; then the tree's leaves, in the refit's
 * (`../tree/treeLeaves.ts`), which follows. Each reads what the one before it wrote — a dispatch sees the
 * storage an earlier one of its pass wrote, the queue's order the rest —: the CPU never waits on
 * the GPU, and no pass composes a world again. The cut, and the decode of the visible clusters
 * after it, read every word of them.
 */
import type { RootsOnGpu } from '../../geometry/dag/runtime/runtimeOps.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { COMPOSE_ROOTS_PASS } from '../../diagnostic/stage/passLabels.ts'
import { encodeComposedRoots } from '../compose/gpuComposeEncode.ts'
import { encodeRootBoxes, rootBoxesKernel } from './rootBoxes.ts'
import { sendRootWorlds } from './rootWorlds.ts'
import { leafKernel, treeLeaves } from '../tree/treeLeaves.ts'
import { abandonPart, createImagePart, submitPart } from '../../frame/render/encoder.ts'

/**
 * Runtime `rt`'s roots' one compute pass, held with its root worlds (`RootWorlds.pass`), made once:
 * opened by the first pass that runs, its command buffer made then — a frame where nothing moved
 * since the last time makes none —, a part of the image it goes before, timed with it
 * (`createImagePart`): timed whenever the frame's encoder is held, a waiting selection's too (it
 * holds its own as the frame's while its cut encodes), plain otherwise. Submitted at once, never in
 * the frame's command buffer: a second cut of the frame rewrites the passes' parameters, and an
 * image dropped would drop the roots it took. A part the queue refuses cancels the timer image it
 * joined (`submitPart`); one the queue took stays in it, and the cut's send closes the image
 * (`dispatchWaitingSelection`).
 */
function rootsPassOf(rt: WebgpuPagesRuntime) {
  return (rt.rootWorlds!.pass ??= {
    open: new LazyComputePass(COMPOSE_ROOTS_PASS),
    // Timed with the image when the frame's encoder is held; otherwise plain.
    encoder: () =>
      createImagePart(rt, rt.gpu.device!, !!rt.timing.frameEncoder, 'Trillion3D roots'),
  })
}

/** Runtime `rt`'s roots brought level on the GPU — the composition's passes first —, their
 *  stretches into `frames`, the frame words of the cut they go before. */
function writeRoots(rt: WebgpuPagesRuntime, frames: GPUTextureView) {
  const device = rt.gpu.device
  if (!device || rt.run.lost) return
  sendRootWorlds(rt, device)
  const held = rootsPassOf(rt)
  let made: GPUCommandEncoder | undefined
  const open = held.open.begin(() => (made = held.encoder()))
  let encoder: GPUCommandEncoder | undefined
  try {
    const composed = encodeComposedRoots(rt, device, open)
    encodeRootBoxes(rt, device, open, composed, frames)
    encoder = open.end()
  } catch (error) {
    // An encode or an end that threw leaves the pass open on a command buffer no one submits: the pass ends and the encoder is dropped, even if the end or the drop throws (said here, the first error stays the one thrown), or it would stay open and hold every resource retired meanwhile.
    try {
      open.end()
    } catch (endError) {
      rt.diag.diagnosticFailure('roots-pass-end-failed', endError)
    }
    try {
      if (made) abandonPart(rt, made)
    } catch (abandonError) {
      rt.diag.diagnosticFailure('roots-pass-abandon-failed', abandonError)
    }
    throw error
  }
  if (encoder) submitPart(rt, device, encoder)
}

/** The roots on the GPU of runtime `rt`, as every cut of its session writes them first. */
export const rootsOnGpu = (rt: WebgpuPagesRuntime): RootsOnGpu => ({
  roots: (frames) => writeRoots(rt, frames.view),
  leaves: treeLeaves(rt),
})

/** Asks the kernels the roots' passes bind at a frame's entry (`../../frame/loop/framePipelines.ts`):
 *  the root boxes pass once there is a root, the tree's leaves once its cut has a tree. */
export function askRootPasses(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.layout.selectionRoots.length) return
  rootBoxesKernel(device).ask()
  const cut = rt.run.gpuSelection
  if (cut?.treeFollowed) leafKernel(cut.treeParented)(device).ask()
}
