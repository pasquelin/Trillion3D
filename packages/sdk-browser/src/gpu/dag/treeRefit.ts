/**
 * THE PLACEMENT TREE REFIT, ON THE GPU: the one pass that fits the tree's nodes again once a
 * change moved what they bound (`treeRefitWgsl.ts`). A caller names the groups its change touched;
 * the pass fits them and every node above them, bottom up, in one compute pass of one command
 * buffer — a dispatch a level, a thread a node — and nothing else of the tree is read or written.
 * The leaves it fits over are the table `members` holds, six doubles a placement: the caller
 * writes the ones it moved (`leaf`, the root's box through the world the CPU holds) or has the GPU
 * write them (a composition's, `treeFollow.ts`), before `run`. The pass is the one entry point of a
 * refit — the placement tree's, and whatever else bounds its boxes the same way.
 *
 * The pass binds the cut's tables as the cut does: a table the device splits across bindings is read
 * through its parts at the bindings the kernel gives them (`dagPartEntries`), the frames through
 * their ranges. Nothing is ever left unfitted, and no group is held open for want of a binding.
 */
import { TREE_REFIT_PASS } from '../../stage/passLabels.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import { dispatchRows } from '../dispatch/grid.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { memberBox, refitLevels, treeNodeCount, type PlacementTree } from './placementTree.ts'
import { REFIT_PARAM_WORDS, treeRefitWgsl, type RefitLayout } from './treeRefitWgsl.ts'
import { DAG_BINDING, dagPartEntries } from './shader/bindings.ts'
import { DAG_NODE_FLOATS, type PackedDag } from './types.ts'
import type { DagParts } from './split.ts'
import { preparedComputePipeline } from '../../lighting/deferred/fullscreen.ts'

/** What a refit reads and writes: the tree's nodes and the order of its members as the device lays
 *  them out, and the frames of each range of placements. */
export type RefitTables = {
  nodeParts: DagParts
  coldParts: DagParts
  frames: { buffers: GPUBuffer[]; ranges: readonly { first: number }[] }
}

/** Bytes a level's parameters take in their buffer: a uniform offset's alignment. */
const PARAM_STRIDE = 256

/** How `tables` lay the refit's tables out: the elements a part holds, the parts, the ranges. */
function layoutOf({ nodeParts, coldParts, frames }: RefitTables): RefitLayout {
  return {
    nodes: { per: nodeParts.bytes / (DAG_NODE_FLOATS * 4), parts: nodeParts.buffers.length },
    cold: { per: coldParts.bytes / 4, parts: coldParts.buffers.length },
    frames: frames.ranges.map(({ first }) => first),
  }
}

export function createTreeRefit(
  device: GPUDevice,
  packed: Pick<
    PackedDag,
    'nodes' | 'rootNodes' | 'rootBases' | 'mark' | 'worldSources' | 'worldCount'
  >,
  tree: PlacementTree,
  tables: RefitTables,
) {
  const layout = layoutOf(tables)
  const worlds = Math.max(1, packed.worldCount)
  const members = device.createBuffer({
    label: 'Trillion3D placement tree leaf boxes',
    size: worlds * 6 * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  // The leaves the build fitted the tree over, as it holds them.
  const words = new Uint32Array(worlds * 12)
  packDoubles(words, 0, tree.boxes)
  device.queue.writeBuffer(members, 0, words)
  const leafWords = new Uint32Array(12)
  // Compiled off the thread as the tree is followed: the frames wait for it, none compiles it.
  const kernel = refitKernel(device, layout).ask()
  let program: ReturnType<typeof refitProgram> | undefined
  return {
    members,
    /** Placement `w`'s leaf box, its root's box through the world the CPU holds, written. */
    leaf(w: number) {
      memberBox(packed, tree, w)
      packDoubles(leafWords, 0, tree.boxes, w * 6, 6)
      device.queue.writeBuffer(members, w * 48, leafWords)
    },
    /** The groups `groups` and every node above them fit again, encoded in `encoder`: the leaves
     *  they hold are those `members` holds when it runs. */
    run(encoder: GPUCommandEncoder, groups: Iterable<number>) {
      const levels = refitLevels(tree, groups)
      if (!levels.length) return
      program ??= refitProgram(device, tree, tables, members, kernel.get())
      const pass = encoder.beginComputePass({ label: TREE_REFIT_PASS })
      pass.setPipeline(program.pipeline)
      pass.setBindGroup(0, program.tables)
      let at = 0
      levels.forEach(({ level, ids }, step) => {
        const below = tree.levels[level + 1],
          here = tree.levels[level]
        const params = new Uint32Array(REFIT_PARAM_WORDS)
        params.set([at, ids.length, here.base, tree.count, tree.members])
        params.set([below?.base ?? 0, below?.count ?? 0, below ? 1 : 0], 5)
        device.queue.writeBuffer(program!.ids, at * 4, ids)
        device.queue.writeBuffer(program!.params, step * PARAM_STRIDE, params)
        pass.setBindGroup(1, program!.groups[step])
        dispatchRows(pass, ceilDiv(ids.length, 64))
        at += ids.length
      })
      pass.end()
    },
    dispose() {
      members.destroy()
      program?.ids.destroy()
      program?.params.destroy()
    },
  }
}

/** The refit kernel of a device for a layout of its tables, made once. */
const kernels = new WeakMap<GPUDevice, Map<string, ReturnType<typeof preparedComputePipeline>>>()
function refitKernel(device: GPUDevice, layout: RefitLayout) {
  const key = JSON.stringify(layout, (_, v) => (v === Infinity ? 'whole' : v))
  const held = kernels.get(device) ?? kernels.set(device, new Map()).get(device)!
  let kernel = held.get(key)
  if (!kernel)
    held.set(
      key,
      (kernel = preparedComputePipeline(device, {
        label: TREE_REFIT_PASS,
        layout: 'auto',
        compute: {
          module: device.createShaderModule({
            label: TREE_REFIT_PASS,
            code: treeRefitWgsl(layout),
          }),
          entryPoint: 'main',
        },
      })),
    )
  return kernel
}

/** The pipeline's lists and parameters, made when the first pass runs: the tables' group once, and
 *  one group of the pass's own per level — the tree's depth is fixed. */
function refitProgram(
  device: GPUDevice,
  tree: PlacementTree,
  { nodeParts, coldParts, frames }: RefitTables,
  members: GPUBuffer,
  pipeline: GPUComputePipeline,
) {
  const ids = device.createBuffer({
    label: 'Trillion3D placement tree refit ids',
    size: Math.max(1, treeNodeCount(tree)) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const params = device.createBuffer({
    label: 'Trillion3D placement tree refit params',
    size: tree.levels.length * PARAM_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // The cut's tables, each at its binding and its parts after the kernel's own range binding.
  const tables = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: DAG_BINDING.nodes, resource: { buffer: nodeParts.buffers[0] } },
      { binding: DAG_BINDING.cold, resource: { buffer: coldParts.buffers[0] } },
      ...dagPartEntries({
        nodes: nodeParts.buffers.slice(1),
        cold: coldParts.buffers.slice(1),
      }),
    ],
  })
  const groups = tree.levels.map((_, step) =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(1),
      entries: [
        {
          binding: 0,
          resource: { buffer: params, offset: step * PARAM_STRIDE, size: REFIT_PARAM_WORDS * 4 },
        },
        { binding: 1, resource: { buffer: ids } },
        { binding: 2, resource: { buffer: members } },
        ...frames.buffers.map((buffer, r) => ({ binding: 3 + r, resource: { buffer } })),
      ],
    }),
  )
  return { pipeline, ids, params, tables, groups }
}
