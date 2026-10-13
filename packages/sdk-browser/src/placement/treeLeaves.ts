/**
 * THE PLACEMENT TREE'S LEAVES ON THE GPU (`treeLeavesWgsl.ts`), the tree follower's one writer of
 * them (`../gpu/dag/treeFollow.ts`): in the refit's command buffer, before the refit, the leaves of
 * the placements it names — a pose a send moved, a park, a mark, an append — and of every root a
 * parent composes, each from the world the GPU holds (`rootWorlds.ts`). The roots' command buffer
 * goes first (`rootPasses.ts`): a world the host moved is sent, a composed one written, before the
 * leaves read it. No leaf is taken on the CPU, and none is kept there.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { grownLength } from '../../../math/src/sequence/resized.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { PRIMITIVE_BYTES } from '../gpu/dag/cameraRanges.ts'
import { DAG_BINDING, dagPartEntries } from '../gpu/dag/shader/bindings.ts'
import { nodeLayout, type NodeTableLayout } from '../gpu/dag/nodeTableWgsl.ts'
import type { TreeFrames, TreeLeaves } from '../gpu/dag/treeFollow.ts'
import { preparedComputePipeline, preparedPipelines } from '../lighting/deferred/fullscreen.ts'
import { uniformStride } from '../residency/pools.ts'
import { liveBuffer } from '../webgpu/core/liveEntries.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { TREE_LEAVES_PASS } from '../stage/passLabels.ts'
import { composeGroup, heldGroup, type HeldGroup } from './composeGroups.ts'
import { rangeParams, writeRangeParams } from './gpuComposeGpu.ts'
import { treeLeavesWgsl } from './treeLeavesWgsl.ts'

/** The leaves kernel for each layout of the nodes it reads, made once a device. */
export const leafKernels = oncePerDevice((device) =>
  preparedPipelines(
    (nodes: NodeTableLayout) =>
      preparedComputePipeline(device, {
        label: TREE_LEAVES_PASS,
        layout: 'auto',
        compute: {
          module: device.createShaderModule({
            label: TREE_LEAVES_PASS,
            code: treeLeavesWgsl(nodes),
          }),
          entryPoint: 'main',
        },
      }),
    (nodes) => `${nodes.per}x${nodes.parts}`,
  ),
)

/** The frames the groups read between two passes: none. */
const NO_FRAMES: TreeFrames = { buffers: [], ranges: [] }

function createTreeLeavesGpu(device: GPUDevice) {
  return {
    /** The parameters of the named placements' dispatches, then of the composed roots'. */
    params: [rangeParams('Trillion3D tree leaves params'), rangeParams('Trillion3D tree leaves')],
    list: undefined as GPUBuffer | undefined,
    absent: device.createBuffer({
      label: 'Trillion3D no leaf list',
      size: 16,
      usage: GPUBufferUsage.STORAGE,
    }),
    /** Each dispatch's group over each range, and the group of the tree's nodes. */
    groups: [[], []] as HeldGroup[][],
    nodes: heldGroup(),
    /** What the groups read live while the pass binds them: the frames of the cut whose tree it
     *  writes the leaves of, and its leaves. */
    frame: { frames: NO_FRAMES as TreeFrames, members: undefined as GPUBuffer | undefined },
  }
}
export type TreeLeavesGpu = ReturnType<typeof createTreeLeavesGpu>

/** The pass's buffers, destroyed with the session. */
export function disposeTreeLeaves(rt: Pick<WebgpuPagesRuntime, 'treeLeaves'>) {
  const gpu = rt.treeLeaves
  if (!gpu) return
  for (const buffer of [gpu.list, gpu.absent, ...gpu.params.map((p) => p.buffer)]) buffer?.destroy()
  rt.treeLeaves = undefined
}

/** The entries of dispatch `g` over range `r` (`treeLeavesWgsl`), read live. */
const entries = (
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  gpu: TreeLeavesGpu,
  g: number,
  r: number,
) =>
  sequentialEntries([
    liveBuffer(
      () => gpu.params[g].buffer,
      () => r * uniformStride(device.limits),
      () => 32,
    ),
    liveBuffer(() => rt.rootWorlds?.worlds),
    liveBuffer(
      () => gpu.frame.frames.buffers[r],
      undefined,
      () => gpu.frame.frames.ranges[r].count * PRIMITIVE_BYTES,
    ),
    liveBuffer(() => gpu.frame.members),
    liveBuffer(() => (g ? rt.compose?.gpu?.rankList : gpu.list) ?? gpu.absent),
  ])

/** The named placements, sent; a list made again when they outgrow it. */
function sendList(device: GPUDevice, gpu: TreeLeavesGpu, ranks: Int32Array, count: number) {
  if (!gpu.list || gpu.list.size < count * 4) {
    gpu.list?.destroy()
    gpu.list = device.createBuffer({
      label: 'Trillion3D tree leaves list',
      size: grownLength(gpu.list ? gpu.list.size : 0, count * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }
  device.queue.writeBuffer(gpu.list, 0, ranks, 0, count)
}

/** The tree's nodes as group 1 of `pipeline`, made again when the pipeline or a part moved. */
function nodesGroup(
  device: GPUDevice,
  gpu: TreeLeavesGpu,
  pipeline: GPUComputePipeline,
  parts: GPUBuffer[],
) {
  const held = gpu.nodes,
    named = held.identity.next
  named.length = 0
  named.push(pipeline, ...parts)
  if (held.identity.moved() || !held.group)
    held.group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(1),
      entries: [
        { binding: DAG_BINDING.nodes, resource: { buffer: parts[0] } },
        ...dagPartEntries({ nodes: parts.slice(1) }),
      ],
    })
  return held.group
}

/** The tree's leaves of runtime `rt`: what the follower of its cut's tree writes them by. */
export function treeLeaves(rt: WebgpuPagesRuntime): TreeLeaves {
  return {
    ready: () => !!rt.rootWorlds?.worlds && !rt.rootWorlds.whole,
    encode(encoder, { members, nodeParts, frames }, { ranks, count, whole }) {
      const device = rt.gpu.device,
        roots = rt.rootWorlds?.sent ?? 0
      if (!device || !roots) return
      const gpu = (rt.treeLeaves ??= createTreeLeavesGpu(device))
      const composed = whole ? 0 : (rt.compose?.rankList.set.count ?? 0),
        listed = whole ? roots : count
      if (!listed && !composed) return
      if (count && !whole) sendList(device, gpu, ranks, count)
      const pipeline = leafKernels(device).of(nodeLayout(nodeParts)).ask().get()
      const pass = encoder.beginComputePass({ label: TREE_LEAVES_PASS })
      pass.setPipeline(pipeline)
      pass.setBindGroup(1, nodesGroup(device, gpu, pipeline, nodeParts.buffers))
      const { ranges } = (gpu.frame.frames = frames)
      gpu.frame.members = members
      for (let g = 0; g < 2; g++) {
        const n = g ? composed : listed
        if (!n) continue
        writeRangeParams(device, gpu.params[g], ranges, roots, n, g === 0 && whole ? 1 : 0)
        for (let r = 0; r < ranges.length; r++) {
          const held = (gpu.groups[g][r] ??= heldGroup())
          held.identity.entries[0] ??= entries(rt, device, gpu, g, r)
          composeGroup(device, held, pipeline)
          pass.setBindGroup(0, held.group!)
          dispatchRows(pass, ceilDiv(n, WORKGROUP_THREADS))
        }
        rt.run.gpuComputeDispatches += ranges.length
      }
      gpu.frame.frames = NO_FRAMES
      gpu.frame.members = undefined
      pass.end()
    },
  }
}
