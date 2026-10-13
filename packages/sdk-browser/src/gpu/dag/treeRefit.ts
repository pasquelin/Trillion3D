/**
 * THE PLACEMENT TREE REFIT, ON THE GPU: the one pass that fits the tree's nodes again once a
 * change moved what they bound (`treeRefitWgsl.ts`). A caller names the groups its change touched;
 * the pass fits them and every node above them, bottom up, in one compute pass of one command
 * buffer — a dispatch a level, a thread a node, the engine's one level loop (`treeRefitLevels.ts`) —
 * and nothing else of the tree is read or written.
 * The leaves it fits over are the table `members` holds, six doubles a placement, which the GPU
 * alone writes (`../../placement/treeLeaves.ts`, through `treeFollow.ts`) before `run`: no leaf is
 * taken nor kept on the CPU. The pass is the one entry point of a refit — the placement tree's, and
 * whatever else bounds its boxes the same way.
 *
 * The pass reads and writes the tree's record table in place (`treeTable.ts`), the frames through
 * their ranges. Nothing is ever left unfitted, and no group is held open for want of a binding.
 */
import { TREE_REFIT_PASS } from '../../stage/passLabels.ts'
import { refitLevels, treeNodeCount, type PlacementTree } from './placementTree.ts'
import { REFIT_PARAM_WORDS, treeRefitWgsl, type RefitLayout } from './treeRefitWgsl.ts'
import type { PackedDag } from './types.ts'
import { preparedComputePipeline, preparedPipelines } from '../../lighting/deferred/fullscreen.ts'
import { oncePerDevice } from '../core/oncePerDevice.ts'
import { sequentialEntries } from '../core/computeBindings.ts'
import { createRefitLevels } from './treeRefitLevels.ts'

/** What a refit reads and writes: the tree's record table (`treeTable.ts`), and the frames of each
 *  range of placements. */
export type RefitTables = {
  tree: GPUTextureView
  frames: { buffers: GPUBuffer[]; ranges: readonly { first: number }[] }
}

/** How `tables` lay the frames out: the first placement of each range. */
const layoutOf = ({ frames }: RefitTables): RefitLayout => ({
  frames: frames.ranges.map(({ first }) => first),
})

export function createTreeRefit(
  device: GPUDevice,
  packed: Pick<PackedDag, 'worldCount'>,
  tree: PlacementTree,
  tables: RefitTables,
) {
  const layout = layoutOf(tables)
  const worlds = Math.max(1, packed.worldCount)
  // Written by the leaves pass alone; a proof of the refit on a device sends the leaves it fits.
  const members = device.createBuffer({
    label: 'Trillion3D placement tree leaf boxes',
    size: worlds * 6 * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  /** A level's own parameters past its ids (`Params`): what it fits and the level below it. */
  const extra = new Uint32Array(REFIT_PARAM_WORDS - 2)
  // Compiled off the thread as the tree is followed: the frames wait for it, none compiles it.
  const kernel = refitKernels(device).of(layout).ask()
  let program: ReturnType<typeof refitProgram> | undefined
  return {
    members,
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
        extra[2] = below?.base ?? 0
        extra[3] = below?.count ?? 0
        extra[4] = below ? 1 : 0
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
    (layout) => JSON.stringify(layout),
  ),
)

/** The pipeline's lists and parameters, made when the first pass runs: the tables' group once, and
 *  one group of the pass's own per level — the tree's depth is fixed. */
function refitProgram(
  device: GPUDevice,
  tree: PlacementTree,
  { tree: table, frames }: RefitTables,
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
  // The tree's record table, read and written in place.
  const tables = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: table }],
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
