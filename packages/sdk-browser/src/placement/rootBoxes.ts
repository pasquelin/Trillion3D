/**
 * THE ROOT BOXES PASS ON THE GPU (`rootBoxesWgsl.ts`): each root whose world moved has its world box
 * and its stretch derived from the world the GPU holds — the roots a send moved (`takeMoved`),
 * every root after a whole send, and the roots a parent composes once the compose worlds pass wrote
 * their worlds anew. It runs in the roots' one compute pass before every cut (`rootPasses.ts`),
 * after the composition's dispatches: the cut reads the stretches, the rows pass the boxes. A move costs the
 * CPU no box and no stretch, and the list of the roots it moved alone.
 */
import { autoKernel } from '../gpu/core/computeStages.ts'
import { liveBuffer, resourceEntry } from '../webgpu/core/liveEntries.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { ROOT_BOXES_PASS } from '../stage/passLabels.ts'
import type { OpenPass } from '../gpu/core/lazyComputePass.ts'
import { takeMoved } from './rootMoves.ts'
import { ROOT_BOXES_ENTRY, ROOT_BOXES_FRAMES_BINDING, ROOT_BOXES_WGSL } from './rootBoxesWgsl.ts'
import {
  createRootList,
  dispatchRootList,
  disposeRootList,
  rootListEntries,
  sendRootList,
} from './rootListPass.ts'

/** The pass's kernel, once a device, compiled off the thread (`askRootPasses`). */
export const rootBoxesKernel = autoKernel(ROOT_BOXES_PASS, ROOT_BOXES_WGSL, ROOT_BOXES_ENTRY)

/** The pass over the moved roots, then the composed roots (`rootListPass.ts`), and what its groups
 *  read live while it binds them: the cut's frame words. */
function createRootBoxesGpu(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const frame = { frames: undefined as GPUTextureView | undefined }
  // Each dispatch's entries (`ROOT_BOXES_WGSL`), read live.
  const pass = createRootList(device, ROOT_BOXES_PASS, (list, g) => [
    ...rootListEntries(rt, list, g, [
      liveBuffer(() => rt.rootWorlds?.worlds),
      liveBuffer(() => rt.rootWorlds?.locals),
      liveBuffer(() => rt.rootWorlds?.boxes),
    ]),
    resourceEntry(ROOT_BOXES_FRAMES_BINDING, () => frame.frames),
  ])
  return { pass, frame }
}
export type RootBoxesGpu = ReturnType<typeof createRootBoxesGpu>

/** The pass's buffers, destroyed with the session. */
export function disposeRootBoxes(rt: Pick<WebgpuPagesRuntime, 'rootBoxes'>) {
  if (rt.rootBoxes) disposeRootList(rt.rootBoxes.pass)
  rt.rootBoxes = undefined
}

/**
 * The world boxes and stretches of the roots whose world moved, into the roots' one compute pass
 * `open` (`rootPasses.ts`), their stretches into `frames`, the cut's frame words: the roots a send
 * moved or made — those a cut took in place before they join included (`rootWorlds.ts`) —, or
 * every root, then the composed roots when the compose worlds pass `composed` them anew (a
 * dispatch over every root holds them already). Nothing while the cut or the worlds are not made —
 * the roots wait for the pass, kept in their list.
 */
export function encodeRootBoxes(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  open: OpenPass,
  composed: boolean,
  frames: GPUTextureView | undefined,
) {
  const held = rt.rootWorlds
  if (!held?.worlds || !frames) return
  const listedComposed = composed ? (rt.compose?.rankList.set.count ?? 0) : 0
  if (!held.roots.whole && !held.roots.count && !listedComposed) return
  const named = takeMoved(held.roots),
    listed = named ? named.length : held.held
  const composedToo = named && listedComposed
  if (!listed && !composedToo) return
  const gpu = (rt.rootBoxes ??= createRootBoxesGpu(rt, device)),
    roots = held.held,
    pass = open.pass,
    pipeline = rootBoxesKernel(device).get()
  if (named?.length) sendRootList(device, gpu.pass, named, named.length)
  gpu.frame.frames = frames
  pass.setPipeline(pipeline)
  if (listed) dispatchRootList(rt, device, pass, pipeline, gpu.pass, 0, roots, listed, !named)
  if (composedToo)
    dispatchRootList(rt, device, pass, pipeline, gpu.pass, 1, roots, listedComposed, false)
  gpu.frame.frames = undefined
}
