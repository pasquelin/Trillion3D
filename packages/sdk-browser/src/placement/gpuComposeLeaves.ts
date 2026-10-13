/**
 * THE COMPOSED LEAVES OF THE PLACEMENT TREE (`gpuCompose.ts`): the members pass, in the refit's
 * command buffer.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { dispatchRows } from '../gpu/dispatch/grid.ts'
import { DAG_BINDING, dagPartEntries } from '../gpu/dag/shader/bindings.ts'
import { nodeLayout } from '../gpu/dag/treeRefit.ts'
import type { ComposedLeaves } from '../gpu/dag/treeFollow.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { COMPOSE_MEMBERS_PASS } from '../stage/passLabels.ts'
import { composedRoot } from './composeBoxes.ts'
import { composeGroup, heldGroup } from './composeGroups.ts'
import { frameParents, memberKernels } from './gpuComposeFrame.ts'
import { NO_RANGES, writeRangeParams } from './gpuComposeGpu.ts'
import { memberEntries } from './gpuComposeEntries.ts'

/**
 * The leaves the placement tree's refit fits over for the roots a parent composes (`treeFollow.ts`):
 * the box of each root's node carried by the world the GPU composes — the leaf `memberBox` makes
 * from a world the CPU holds. Every composed root is written whenever the tree is fitted again: a
 * thread each of the composed roots (`rankList`), a few products, only on the frames a fit runs.
 */
export function composedLeaves(rt: WebgpuPagesRuntime): ComposedLeaves {
  return {
    has: (w) => composedRoot(rt, w),
    encode(encoder, { members, nodeParts }) {
      const state = rt.compose,
        device = rt.gpu.device,
        selection = rt.run.gpuSelection
      if (!state?.parentIds.size || !device || !selection) return
      const gpu = frameParents(rt, device)
      const listed = state.rankList.set.count
      if (!gpu?.parents || !gpu.rankList || !listed) return
      const pipeline = memberKernels(device).of(nodeLayout(nodeParts)).ask().get(),
        ranges = selection.worldRanges
      writeRangeParams(device, gpu.memberParams, ranges, state.roots, listed)
      const nodes = gpu.memberNodes,
        named = nodes.identity.next
      named.length = 0
      named.push(pipeline, ...nodeParts.buffers)
      if (nodes.identity.moved() || !nodes.group)
        nodes.group = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: [
            { binding: DAG_BINDING.nodes, resource: { buffer: nodeParts.buffers[0] } },
            ...dagPartEntries({ nodes: nodeParts.buffers.slice(1) }),
          ],
        })
      const pass = encoder.beginComputePass({ label: COMPOSE_MEMBERS_PASS })
      pass.setPipeline(pipeline)
      pass.setBindGroup(1, nodes.group)
      gpu.frame.ranges = ranges
      gpu.frame.members = members
      for (let r = 0; r < ranges.length; r++) {
        const held = (gpu.memberGroups[r] ??= heldGroup())
        held.identity.entries[0] ??= memberEntries(device, gpu, r)
        composeGroup(device, held, pipeline)
        pass.setBindGroup(0, held.group!)
        dispatchRows(pass, ceilDiv(listed, 64))
      }
      gpu.frame.ranges = NO_RANGES
      pass.end()
      rt.run.gpuComputeDispatches += ranges.length
    },
  }
}
