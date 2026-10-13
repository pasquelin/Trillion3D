/**
 * THE PLACEMENT TREE REFIT, ON THE GPU: the one pass that fits the tree's nodes again once a
 * change moved what they bound (`treeRefitWgsl.ts`). A caller names the groups its change touched;
 * the pass fits them and every node above them, bottom up, in one compute pass of one command
 * buffer — a dispatch a level, a thread a node, the engine's one level loop (`treeRefitLevels.ts`) —
 * and nothing else of the tree is read or written.
 * The leaves it fits over are the table `members` holds, six doubles a placement: the caller
 * writes the ones it moved (`leaves`, the root's box through the world the CPU holds, sent in the
 * cut's one run writer's ranges) or has the GPU write them (a composition's, `treeFollow.ts`),
 * before `run`. The pass is the one entry point of a refit — the placement tree's, and whatever else
 * bounds its boxes the same way.
 *
 * The pass binds the cut's tables as the cut does: a table the device splits across bindings is read
 * through its parts at the bindings the kernel gives them (`dagPartEntries`), the frames through
 * their ranges. Nothing is ever left unfitted, and no group is held open for want of a binding.
 */
import { TREE_REFIT_PASS } from '../../stage/passLabels.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import { memberBox, refitLevels, treeNodeCount, type PlacementTree } from './placementTree.ts'
import { REFIT_PARAM_WORDS, treeRefitWgsl, type RefitLayout } from './treeRefitWgsl.ts'
import { DAG_BINDING, dagPartEntries } from './shader/bindings.ts'
import { DAG_NODE_FLOATS, type PackedDag } from './types.ts'
import { writeRanges, type DagParts } from './split.ts'
import { preparedComputePipeline, preparedPipelines } from '../../lighting/deferred/fullscreen.ts'
import { oncePerDevice } from '../core/oncePerDevice.ts'
import { sequentialEntries } from '../core/computeBindings.ts'
import { createRefitLevels } from './treeRefitLevels.ts'

/** What a refit reads and writes: the tree's nodes and the order of its members as the device lays
 *  them out, and the frames of each range of placements. */
export type RefitTables = {
  nodeParts: DagParts
  coldParts: DagParts
  frames: { buffers: GPUBuffer[]; ranges: readonly { first: number }[] }
}

/** How the device lays the tree's nodes out: the nodes a part holds, the parts — what a kernel
 *  reading them is made for (`nodeTableBlock`). */
export const nodeLayout = (nodeParts: DagParts): RefitLayout['nodes'] => ({
  per: nodeParts.bytes / (DAG_NODE_FLOATS * 4),
  parts: nodeParts.buffers.length,
})

/** How `tables` lay the refit's tables out: the elements a part holds, the parts, the ranges. */
function layoutOf({ nodeParts, coldParts, frames }: RefitTables): RefitLayout {
  return {
    nodes: nodeLayout(nodeParts),
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
  // The leaves a sync wrote, sent as runs of the words above (`writeRanges`): a run's gap sends
  // the leaves as last sent, and a composed leaf it covers is written again by the composition's
  // pass, encoded after the writes land (`treeFollow.ts`).
  const leafSource = { data: words, sourceBase: 0, targetBase: 0, stride: 12 }
  const toMembers = (offset: number, data: ArrayBuffer, from: number, size: number) =>
    device.queue.writeBuffer(members, offset, data, from, size)
  /** A level's own parameters past its ids (`Params`): what it fits and the level below it. */
  const extra = new Uint32Array(REFIT_PARAM_WORDS - 2)
  // Compiled off the thread as the tree is followed: the frames wait for it, none compiles it.
  const kernel = refitKernels(device).of(layout).ask()
  let program: ReturnType<typeof refitProgram> | undefined
  return {
    members,
    /** The leaf boxes of the `count` placements `sorted` names, ascending — each its root's box
     *  through the world the CPU holds —, written in the fewest runs. */
    leaves(sorted: Int32Array, count: number) {
      for (let k = 0; k < count; k++) {
        const w = sorted[k]
        memberBox(packed, tree, w)
        packDoubles(words, w * 12, tree.boxes, w * 6, 6)
      }
      writeRanges(device, toMembers, sorted, count, leafSource)
    },
    /** The groups `groups` and every node above them fit again, encoded in `encoder`: the leaves
     *  they hold are those `members` holds when it runs. */
    run(encoder: GPUCommandEncoder, groups: Iterable<number>) {
      const levels = refitLevels(tree, groups)
      if (!levels.length) return
      program ??= refitProgram(device, tree, tables, members, kernel.get())
      const { groups: bound, steps } = program
      let at = 0
      for (let step = 0; step < levels.length; step++) {
        const { level, ids } = levels[step]
        const below = tree.levels[level + 1],
          here = tree.levels[level]
        extra[0] = here.base
        extra[1] = tree.count
        extra[2] = tree.members
        extra[3] = below?.base ?? 0
        extra[4] = below?.count ?? 0
        extra[5] = below ? 1 : 0
        steps.set(step, at, ids.length, extra)
        device.queue.writeBuffer(program.ids, at * 4, ids)
        at += ids.length
      }
      const pass = encoder.beginComputePass({ label: TREE_REFIT_PASS })
      pass.setPipeline(program.pipeline)
      pass.setBindGroup(0, program.tables)
      steps.encode(pass, levels.length, (open, step) => open.setBindGroup(1, bound[step]))
      pass.end()
    },
    dispose() {
      members.destroy()
      program?.ids.destroy()
      program?.steps.dispose()
    },
  }
}

/** The refit kernels of a device, one a layout of its tables, each made once. */
const refitKernels = oncePerDevice((device: GPUDevice) =>
  preparedPipelines(
    (layout: RefitLayout) =>
      preparedComputePipeline(device, {
        label: TREE_REFIT_PASS,
        layout: 'auto',
        compute: {
          module: device.createShaderModule({
            label: TREE_REFIT_PASS,
            code: treeRefitWgsl(layout),
          }),
          entryPoint: 'main',
        },
      }),
    (layout) => JSON.stringify(layout, (_, v) => (v === Infinity ? 'whole' : v)),
  ),
)

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
  const steps = createRefitLevels(
    device,
    'Trillion3D placement tree refit params',
    tree.levels.length,
    REFIT_PARAM_WORDS,
  )
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
      entries: sequentialEntries([
        {
          buffer: steps.params,
          offset: steps.slots.offset(step)[0],
          size: REFIT_PARAM_WORDS * 4,
        },
        { buffer: ids },
        { buffer: members },
        ...frames.buffers.map((buffer) => ({ buffer })),
      ]),
    }),
  )
  return { pipeline, ids, steps, tables, groups }
}
