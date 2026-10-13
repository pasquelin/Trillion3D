// The placement tree's GPU refit (`gpu/dag/treeRefit.ts`) run on a real device over a generated
// field: the nodes it leaves are the CPU build's (`packPlacementTree`) after the same change, word
// for word, with the tables whole and with the nodes, the order and the frames split across
// buffers, bound by the cut's own part bindings.
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { placementField } from '../../../packages/sdk-browser/src/gpu/dag/placementTree.fixture.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import {
  treeNodeCount,
  TREE_SPAN,
} from '../../../packages/sdk-browser/src/gpu/dag/placementTree.ts'
import {
  refitTree,
  treeChange,
} from '../../../packages/sdk-browser/src/gpu/dag/treeRefitRun.fixture.ts'
import { createTreeRefit } from '../../../packages/sdk-browser/src/gpu/dag/treeRefit.ts'
import {
  DAG_NODE_FLOATS,
  FRAME_ROW_WORDS,
} from '../../../packages/sdk-browser/src/gpu/dag/types.ts'

/** The words of `data` in `parts` buffers of `per` words each but the last. */
function inBuffers(device: GPUDevice, data: Uint32Array<ArrayBuffer>, per: number, parts: number) {
  return Array.from({ length: parts }, (_, p) => {
    const words = data.subarray(p * per, p === parts - 1 ? undefined : (p + 1) * per)
    const buffer = device.createBuffer({
      size: Math.max(4, words.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(buffer, 0, words)
    return buffer
  })
}

/** One refit on the device: `split` lays the tables out in parts. */
export async function runRefit(split: boolean) {
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: true }
  const { device } = gpu
  const roots = placementField(100, 5),
    dag = packDagSelection(roots),
    tree = dag.placementTree!
  const nodeWords = new Uint32Array(dag.nodes.buffer, dag.nodes.byteOffset, dag.nodes.length)
  const held = Uint32Array.from(nodeWords)
  const frames = new Uint32Array(roots.length * FRAME_ROW_WORDS)
  const writeFrames = () => {
    for (let w = 0; w < roots.length; w++) {
      frames[w * FRAME_ROW_WORDS + 1] = dag.rootNodes[w]
      frames[w * FRAME_ROW_WORDS + 3] = dag.mark[w]
    }
  }
  writeFrames()
  const cold = new Uint32Array(tree.members + tree.capacity)
  for (let k = 0; k < tree.capacity; k++) cold[tree.members + k] = tree.order[k]
  // The tables as the device lays them: whole, or split inside the tree's own range.
  const nodesPer = split ? tree.cellBase + 60 : Infinity,
    nodeParts = split ? 2 : 1,
    coldPer = split ? 4096 : Infinity,
    coldCount = split ? 2 : 1,
    framesAt = split ? [0, 5000] : [0]
  const nodes = inBuffers(
    device,
    held,
    (split ? nodesPer : held.length / 1) * DAG_NODE_FLOATS,
    nodeParts,
  )
  const coldBuffers = inBuffers(device, cold, split ? coldPer : cold.length, coldCount)
  const frameBuffers = framesAt.map((first, r) => {
    const end = framesAt[r + 1] ?? roots.length
    return inBuffers(
      device,
      frames.subarray(first * FRAME_ROW_WORDS, end * FRAME_ROW_WORDS),
      end * FRAME_ROW_WORDS,
      1,
    )[0]
  })
  const refit = createTreeRefit(device, dag, tree, {
    nodeParts: { buffers: nodes, bytes: (split ? nodesPer : held.length) * DAG_NODE_FLOATS * 4 },
    coldParts: { buffers: coldBuffers, bytes: (split ? coldPer : cold.length) * 4 },
    frames: { buffers: frameBuffers, ranges: framesAt.map((first) => ({ first })) },
  })
  // The first fit, on the GPU: every group, from the open tree the pack leaves.
  const everyGroup = Array.from({ length: tree.levels.at(-1)!.count }, (_, g) => g)
  const first = device.createCommandEncoder()
  refit.run(first, everyGroup)
  device.queue.submit([first.finish()])
  // The change: poses a long way off, a park, a mark that opens, a whole group parked.
  const touched = treeChange(dag, roots)
  writeFrames()
  // The frame words the change moved go up, as the cut's run writes them.
  framesAt.forEach((first, r) => {
    const end = framesAt[r + 1] ?? roots.length
    device.queue.writeBuffer(
      frameBuffers[r],
      0,
      frames.subarray(first * FRAME_ROW_WORDS, end * FRAME_ROW_WORDS),
    )
  })
  const moved = Int32Array.from(touched).sort()
  refit.leaves(moved, moved.length)
  const groups = new Set([...touched].map((w) => Math.floor(tree.slot[w] / TREE_SPAN)))
  const encoder = device.createCommandEncoder()
  refit.run(encoder, groups)
  device.queue.submit([encoder.finish()])
  const read: number[] = []
  for (const [p, buffer] of nodes.entries()) {
    const words = (await readGpuBuffer(device, buffer, buffer.size))!
    for (const word of words) read.push(word)
    void p
  }
  // The interpreter's fit of every group over the same leaves: what the device must hold.
  refitTree(dag)
  const from = tree.cellBase * DAG_NODE_FLOATS,
    last = (tree.cellBase + treeNodeCount(tree)) * DAG_NODE_FLOATS
  const expected = Array.from(
    new Uint32Array(dag.nodes.buffer, dag.nodes.byteOffset, dag.nodes.length),
  )
  const untouched = Array.from(held.subarray(0, from)).every((word, k) => read[k] === word)
  const { court } = await gpu.fermer()
  return {
    adapter: court,
    errors: gpu.errors,
    differing: Array.from({ length: last - from }, (_, k) => from + k).filter(
      (k) => read[k] !== expected[k],
    ).length,
    compared: last - from,
    untouched,
  }
}
