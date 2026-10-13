// The placement tree's GPU refit (`gpu/dag/treeRefit.ts`) run on a real device over a generated
// field: the nodes it leaves in the tree's record table (`treeTable.ts`), read and written in place,
// are the CPU build's (`packPlacementTree`) after the same change, word for word, the frame words
// read in their record table (`frameTable.ts`); the tree's order beside them is never written.
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { placementField } from '../../../packages/sdk-browser/src/gpu/dag/placementTree.fixture.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import {
  treeNodeCount,
  TREE_SPAN,
} from '../../../packages/sdk-browser/src/gpu/dag/placementTree.ts'
import {
  leafBoxes,
  refitTree,
  treeChange,
} from '../../../packages/sdk-browser/src/gpu/dag/treeRefitRun.fixture.ts'
import { packDoubles } from '../../../packages/math/src/float/splitDouble.ts'
import { createTreeRefit } from '../../../packages/sdk-browser/src/gpu/dag/treeRefit.ts'
import { createTreeTable, TREE_TABLE } from '../../../packages/sdk-browser/src/gpu/dag/treeTable.ts'
import {
  recordExtentOf,
  recordTable,
} from '../../../packages/sdk-browser/src/gpu/core/recordTexture.fixture.ts'
import { createRecordTexture } from '../../../packages/sdk-browser/src/gpu/core/recordTexture.ts'
import { FRAME_TABLE } from '../../../packages/sdk-browser/src/gpu/dag/frameTable.ts'
import {
  DAG_NODE_FLOATS,
  FRAME_ROW_WORDS,
} from '../../../packages/sdk-browser/src/gpu/dag/types.ts'

/** The words of the tree's table `texture` holds, read back: one layer, as `recordTable` lays them. */
async function tableWords(device: GPUDevice, texture: GPUTexture, records: number) {
  const { width, height } = recordExtentOf(TREE_TABLE, records),
    bytes = width * height * 4
  const into = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const encoder = device.createCommandEncoder()
  // A row of the table is 4864 words, 19456 bytes: a multiple of 256, as a copy asks.
  encoder.copyTextureToBuffer({ texture }, { buffer: into, bytesPerRow: width * 4 }, [
    width,
    height,
    1,
  ])
  device.queue.submit([encoder.finish()])
  const words = (await readGpuBuffer(device, into, bytes))!
  into.destroy()
  return new Uint32Array(words)
}

/** One refit on the device. */
export async function runRefit() {
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: true }
  const { device } = gpu
  const roots = placementField(100, 5),
    dag = packDagSelection(roots),
    tree = dag.placementTree!,
    nodes = treeNodeCount(tree)
  const frames = new Uint32Array(roots.length * FRAME_ROW_WORDS)
  const writeFrames = () => {
    for (let w = 0; w < roots.length; w++) {
      frames[w * FRAME_ROW_WORDS + 1] = dag.rootNodes[w]
      frames[w * FRAME_ROW_WORDS + 3] = dag.mark[w]
    }
  }
  writeFrames()
  // The tree's table as the engine makes it, readable back.
  const table = createTreeTable(device, tree, (descriptor) =>
    device.createTexture({ ...descriptor, usage: descriptor.usage | GPUTextureUsage.COPY_SRC }),
  )
  // The frame words' table as the engine's host writes it (`cameraFrames.ts`).
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    frameTable = createRecordTexture(device, FRAME_TABLE, roots.length, usage)
  const sendFrames = () => frameTable.write('Row', 0, roots.length, frames.buffer, 0)
  sendFrames()
  const refit = createTreeRefit(device, dag, tree, { tree: table.view, frames: frameTable.view })
  // The leaves as the GPU writes them (`treeLeavesWgsl.ts`, proven against `leafBoxes`), sent.
  const sendLeaves = () => {
    const leaves = leafBoxes(dag),
      words = new Uint32Array(leaves.length * 2)
    packDoubles(words, 0, leaves)
    device.queue.writeBuffer(refit.members, 0, words)
  }
  sendLeaves()
  // The first fit, on the GPU: every group, from the open tree the pack leaves.
  const everyGroup = Array.from({ length: tree.levels.at(-1)!.count }, (_, g) => g)
  const first = device.createCommandEncoder()
  refit.run(first, everyGroup)
  device.queue.submit([first.finish()])
  // The change: poses a long way off, a park, a mark that opens, a whole group parked.
  const touched = treeChange(dag, roots)
  writeFrames()
  // The frame words the change moved go up, as the cut's run writes them.
  sendFrames()
  sendLeaves()
  const groups = new Set([...touched].map((w) => Math.floor(tree.slot[w] / TREE_SPAN)))
  const encoder = device.createCommandEncoder()
  refit.run(encoder, groups)
  device.queue.submit([encoder.finish()])
  const held = recordTable(TREE_TABLE, nodes, await tableWords(device, table.texture, nodes))
  // The interpreter's fit of every group over the same leaves: what the device must hold.
  refitTree(dag)
  const expected = new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset, tree.nodes.length)
  let differing = 0
  for (let n = 0; n < nodes; n++) {
    const read = held.get('Node', n)
    for (let k = 0; k < DAG_NODE_FLOATS; k++)
      if (read[k] !== expected[n * DAG_NODE_FLOATS + k]) differing++
  }
  let untouched = true
  for (let k = 0; k < tree.capacity; k++)
    if (held.get('Members', Math.floor(k / TREE_SPAN))[k % TREE_SPAN] !== tree.order[k])
      untouched = false
  table.destroy()
  frameTable.destroy()
  refit.dispose()
  const { court } = await gpu.fermer()
  return {
    adapter: court,
    errors: gpu.errors,
    differing,
    compared: nodes * DAG_NODE_FLOATS,
    untouched,
  }
}
