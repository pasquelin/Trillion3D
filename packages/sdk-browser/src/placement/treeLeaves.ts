/**
 * THE PLACEMENT TREE'S LEAVES ON THE GPU (`treeLeavesWgsl.ts`), the tree follower's one writer of
 * them (`../gpu/dag/treeFollow.ts`): in the refit's command buffer, before the refit, the leaves of
 * the placements it names — a pose a send moved, a park, a mark, an append — and of every root a
 * parent composes, each from the world the GPU holds (`rootWorlds.ts`). The roots' command buffer
 * goes first (`rootPasses.ts`): a world the host moved is sent, a composed one written, before the
 * leaves read it. No leaf is taken on the CPU, and none is kept there.
 */
import { autoKernel } from '../gpu/core/computeStages.ts'
import type { TreeLeaves } from '../gpu/dag/treeFollow.ts'
import { liveBuffer, resourceEntry } from '../webgpu/core/liveEntries.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { TREE_LEAVES_PASS } from '../stage/passLabels.ts'
import {
  TREE_LEAVES_FRAMES_BINDING,
  TREE_LEAVES_NODES_BINDING,
  TREE_LEAVES_WGSL,
} from './treeLeavesWgsl.ts'
import {
  createRootList,
  dispatchRootList,
  disposeRootList,
  rootListEntries,
  sendRootList,
} from './rootListPass.ts'

/** The leaves kernel, made once a device. */
export const leafKernel = autoKernel(TREE_LEAVES_PASS, TREE_LEAVES_WGSL, 'main')

/** The pass over the named placements, then the composed roots (`rootListPass.ts`), and what its
 *  groups read live while it binds them: the frame words and the nodes of the cut whose tree it
 *  writes the leaves of, and its leaves. */
function createTreeLeavesGpu(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const frame = {
    frames: undefined as GPUTextureView | undefined,
    nodes: undefined as GPUTextureView | undefined,
    members: undefined as GPUBuffer | undefined,
  }
  // Each dispatch's entries (`treeLeavesWgsl.ts`), read live.
  const pass = createRootList(device, TREE_LEAVES_PASS, (list, g) => [
    ...rootListEntries(rt, list, g, [
      liveBuffer(() => rt.rootWorlds?.worlds),
      liveBuffer(() => frame.members),
    ]),
    resourceEntry(TREE_LEAVES_FRAMES_BINDING, () => frame.frames),
    resourceEntry(TREE_LEAVES_NODES_BINDING, () => frame.nodes),
  ])
  return { pass, frame }
}
export type TreeLeavesGpu = ReturnType<typeof createTreeLeavesGpu>

/** The pass's buffers, destroyed with the session. */
export function disposeTreeLeaves(rt: Pick<WebgpuPagesRuntime, 'treeLeaves'>) {
  if (rt.treeLeaves) disposeRootList(rt.treeLeaves.pass)
  rt.treeLeaves = undefined
}

/** The tree's leaves of runtime `rt`: what the follower of its cut's tree writes them by. */
export function treeLeaves(rt: WebgpuPagesRuntime): TreeLeaves {
  return {
    ready: () => !!rt.rootWorlds?.worlds && !rt.rootWorlds.whole,
    encode(encoder, { members, nodes, frames }, { ranks, count, whole }) {
      const device = rt.gpu.device,
        roots = rt.rootWorlds?.sent ?? 0
      if (!device || !roots) return
      const composed = whole ? 0 : (rt.compose?.rankList.set.count ?? 0),
        listed = whole ? roots : count
      if (!listed && !composed) return
      const gpu = (rt.treeLeaves ??= createTreeLeavesGpu(rt, device))
      if (count && !whole) sendRootList(device, gpu.pass, ranks, count)
      const pipeline = leafKernel(device).ask().get()
      const pass = encoder.beginComputePass({ label: TREE_LEAVES_PASS })
      pass.setPipeline(pipeline)
      gpu.frame.frames = frames
      gpu.frame.nodes = nodes
      gpu.frame.members = members
      if (listed) dispatchRootList(rt, device, pass, pipeline, gpu.pass, 0, roots, listed, whole)
      if (composed)
        dispatchRootList(rt, device, pass, pipeline, gpu.pass, 1, roots, composed, false)
      gpu.frame.frames = undefined
      gpu.frame.nodes = undefined
      gpu.frame.members = undefined
      pass.end()
    },
  }
}
