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
 * Where the device splits the tables across bindings, or the cut is made over several ranges, no
 * pass binds them whole: the chain of each touched group is opened instead (`open`) — a box no plane
 * rejects, the tree's no-cull answer — never left as it was.
 */
import { oncePerDevice } from '../core/oncePerDevice.ts'
import { TREE_REFIT_PASS } from '../../stage/passLabels.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import { dispatchRows } from '../dispatch/grid.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { memberBox, treeNodeCount, TREE_SPAN, type PlacementTree } from './placementTree.ts'
import {
  OPEN_HIGH_BITS,
  OPEN_LOW_BITS,
  REFIT_PARAM_WORDS,
  TREE_REFIT_WGSL,
} from './treeRefitWgsl.ts'
import { DAG_NODE_FLOATS, type PackedDag } from './types.ts'
import { NODE_MAX, NODE_MIN } from './nodeLayout.ts'
import { writeParts, type DagParts } from './split.ts'
import { preparedComputePipeline } from '../../lighting/deferred/fullscreen.ts'

/** The nodes to fit at each level of `tree` once `groups` changed, bottom up: each level's, as
 *  their index within it, increasing. */
export function refitLevels(tree: PlacementTree, groups: Iterable<number>) {
  let touched = new Set(groups)
  const levels: { level: number; ids: Uint32Array<ArrayBuffer> }[] = []
  for (let l = tree.levels.length - 1; l >= 0 && touched.size; l--) {
    levels.push({ level: l, ids: new Uint32Array([...touched].sort((a, b) => a - b)) })
    const above = new Set<number>()
    for (const j of touched) above.add(Math.floor(j / TREE_SPAN))
    touched = above
  }
  return levels
}

/** What a refit reads and writes: the tree's tables as buffers, whole, and as parts. */
export type RefitTables = {
  /** The tree's nodes, frames and cold words, each whole — absent where the device splits them. */
  nodes?: GPUBuffer
  frames?: GPUBuffer
  cold?: GPUBuffer
  nodeParts: DagParts
}

/** Bytes a level's parameters take in their buffer: a uniform offset's alignment. */
const PARAM_STRIDE = 256

export function createTreeRefit(
  device: GPUDevice,
  packed: Pick<
    PackedDag,
    'nodes' | 'rootNodes' | 'rootBases' | 'mark' | 'worldSources' | 'worldCount'
  >,
  tree: PlacementTree,
  tables: RefitTables,
) {
  const { nodes, frames, cold } = tables
  const gpu = nodes && frames && cold ? { nodes, frames, cold } : undefined
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
  const kernel = gpu && refitKernel(device).ask()
  let program: ReturnType<typeof refitProgram> | undefined
  return {
    members,
    /** Whether the refit is the pass: else it opens the chains it is given. */
    supported: !!gpu,
    /** Placement `w`'s leaf box, its root's box through the world the CPU holds, written. */
    leaf(w: number) {
      memberBox(packed, tree, w)
      packDoubles(leafWords, 0, tree.boxes, w * 6, 6)
      device.queue.writeBuffer(members, w * 48, leafWords)
    },
    /** The groups `groups` and every node above them fit again, encoded in `encoder`: the leaves
     *  they hold are those `members` holds when it runs. */
    run(encoder: GPUCommandEncoder, groups: Iterable<number>) {
      if (!gpu) return
      const levels = refitLevels(tree, groups)
      if (!levels.length) return
      program ??= refitProgram(device, tree, gpu, members, kernel!.get())
      const pass = encoder.beginComputePass({ label: TREE_REFIT_PASS })
      pass.setPipeline(program.pipeline)
      let at = 0
      levels.forEach(({ level, ids }, step) => {
        const below = tree.levels[level + 1],
          here = tree.levels[level]
        const params = new Uint32Array(REFIT_PARAM_WORDS)
        params.set([at, ids.length, here.base, tree.count, tree.members])
        params.set([below?.base ?? 0, below?.count ?? 0, below ? 1 : 0], 5)
        device.queue.writeBuffer(program!.ids, at * 4, ids)
        device.queue.writeBuffer(program!.params, step * PARAM_STRIDE, params)
        pass.setBindGroup(0, program!.groups[step])
        dispatchRows(pass, ceilDiv(ids.length, 64))
        at += ids.length
      })
      pass.end()
    },
    /** The chains above `groups` opened, in the nodes' own words: what a device that cannot bind
     *  the tables whole leaves its tree as. */
    open(groups: Iterable<number>) {
      const row = new Float32Array(DAG_NODE_FLOATS),
        bits = new Uint32Array(row.buffer)
      for (const { level, ids } of refitLevels(tree, groups))
        for (const j of ids) {
          const at = (tree.levels[level].base + j) * DAG_NODE_FLOATS * 4
          for (let a = 0; a < 3; a++) {
            bits[NODE_MIN + a] = OPEN_LOW_BITS
            bits[NODE_MAX + a] = OPEN_HIGH_BITS ^ 0x80000000
          }
          writeParts(device, tables.nodeParts, at, row.buffer, 0, DAG_NODE_FLOATS * 4)
        }
    },
    dispose() {
      members.destroy()
      program?.ids.destroy()
      program?.params.destroy()
    },
  }
}

/** The refit kernel of a device, made once. */
const refitKernel = oncePerDevice((device) =>
  preparedComputePipeline(device, {
    label: TREE_REFIT_PASS,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ label: TREE_REFIT_PASS, code: TREE_REFIT_WGSL }),
      entryPoint: 'main',
    },
  }),
)

/** The pipeline, the lists and the parameters of the passes, made when the first one runs, and one
 *  group per level: the tree's depth is fixed. */
function refitProgram(
  device: GPUDevice,
  tree: PlacementTree,
  gpu: { nodes: GPUBuffer; frames: GPUBuffer; cold: GPUBuffer },
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
  const groups = tree.levels.map((_, step) =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: params, offset: step * PARAM_STRIDE, size: REFIT_PARAM_WORDS * 4 },
        },
        { binding: 1, resource: { buffer: ids } },
        { binding: 2, resource: { buffer: gpu.nodes } },
        { binding: 3, resource: { buffer: members } },
        { binding: 4, resource: { buffer: gpu.frames } },
        { binding: 5, resource: { buffer: gpu.cold } },
      ],
    }),
  )
  return { pipeline, ids, params, groups }
}

export type TreeRefit = ReturnType<typeof createTreeRefit>
