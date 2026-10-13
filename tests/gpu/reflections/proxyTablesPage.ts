// The page of the proxy-tables proof (`proxy-tables.gpu.ts`), on the engine's device: the shipped walk over
// the culling's worlds and placement tree in their record tables against the walk of before, over the same
// scene and rays; and the engine's own proxy over a world the culling splits in ranges, against the same
// world held whole.
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { reporting } from '../kit/reportingDevice.ts'
import { NEW_WALK, oldWalk, walk } from './proxyWalks.ts'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { cubeCut, world } from '../../../packages/sdk-browser/src/bounce/runtimeScene.fixture.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { hypot3 } from '../../../packages/math/src/float/hypot.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import {
  RUNTIME_HEADER,
  RUNTIME_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/bounce/runtimeLayout.ts'
import { createRecordTexture } from '../../../packages/sdk-browser/src/gpu/core/recordTexture.ts'
import { WORLD_TABLE } from '../../../packages/sdk-browser/src/gpu/dag/worldTable.ts'
import { createTreeTable } from '../../../packages/sdk-browser/src/gpu/dag/treeTable.ts'
import {
  scenePages,
  sceneRoots,
} from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts'
import {
  createGpuDagSelection,
  packDagSelection,
} from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { FRAME_ROW_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'
import { surface } from '../../../packages/sdk-browser/src/gpu/dag/proxyInstances.fixture.ts'

/** `count` rays over a field `side` cubes wide spaced three metres apart: half cast down at a cube's
 *  neighbourhood from above, half anywhere. */
function rays(count: number, side: number, seed: number) {
  const next = lcgRandom(seed),
    out = new Float32Array(count * 8),
    span = side * 3 + 4
  for (let i = 0; i < count; i++) {
    const o = [next() * span - 2, 6, next() * span - 2]
    const to =
      i % 2
        ? [next() * span - 2, next() * 2 - 1, next() * span - 2]
        : [o[0] + next() - 0.5, 0.5, o[2] + next() - 0.5]
    if (i % 4 === 3) o[1] = next() * 3 - 1
    const d = to.map((v, a) => v - o[a]),
      length = hypot3(d[0], d[1], d[2]) || 1
    out.set([...o, 1000, ...d.map((v) => v / length), 0], i * 8)
  }
  return out
}

/** The shipped walk and the walk of before over `count` cubes and `rayCount` rays, each hit's words. */
export async function compareWalks({
  count,
  seed,
  rayCount,
}: {
  count: number
  seed: number
  rayCount: number
}) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device, errors } = gpu
  const copies = [
    new G.Matrix4().makeTranslation(-4, 0, -4),
    new G.Matrix4().makeTranslation(-8, 1, 0),
  ]
  const scene = world(count, seed, { copies })
  // The proxy's buffer: the header's fields at their words (`RUNTIME_HEADER`), then its words.
  const words = new Uint32Array(RUNTIME_HEADER_WORDS + scene.header.words.length)
  for (const [name, at] of Object.entries(RUNTIME_HEADER)) {
    const value = scene.header[name as keyof typeof scene.header] as number
    words[at] = name === 'error' ? new Uint32Array(Float32Array.of(value).buffer)[0] : value
  }
  words.set(scene.header.words, RUNTIME_HEADER_WORDS)
  const proxy = device.createBuffer({
    size: words.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(proxy, 0, words)
  // The culling's records, as the host writes them — each placement's world, then every instance, a
  // copy's behind the placements —, and the worlds as the proxy mirrored them.
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  const held = count + copies.length
  const table = createRecordTexture(device, WORLD_TABLE, held, usage)
  const matrices = scene.packed.worlds.slice(0, count * 16),
    origins = new Uint32Array(count * 8)
  for (let w = 0; w < count; w++) origins.set(scene.worlds.get('Origin', w), w * 8)
  table.write('Matrix', 0, count, matrices.buffer, 0)
  table.write('Origin', 0, count, origins.buffer, 0)
  const mirrored = new Uint32Array(count * 24)
  mirrored.set(new Uint32Array(matrices.buffer))
  mirrored.set(origins, count * 16)
  const oldWorlds = device.createBuffer({
    size: mirrored.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(oldWorlds, 0, mirrored)
  // The placement tree in its table, as the engine makes it, and as the proxy mirrored it: its
  // nodes, then its order.
  const tree = scene.packed.placementTree,
    treeTable = createTreeTable(device, tree)
  const nodeWords = tree ? new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset) : [],
    treeWords = new Uint32Array(Math.max(1, nodeWords.length + (tree?.capacity ?? 0)))
  treeWords.set(nodeWords)
  if (tree) treeWords.set(tree.order, nodeWords.length)
  const oldTree = device.createBuffer({
    size: treeWords.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(oldTree, 0, treeWords)
  // The instances in the records, and as the proxy's buffer held them, four words each.
  const instanceWords = new Uint32Array(held * 4)
  for (let w = 0; w < held; w++) instanceWords.set(scene.worlds.get('Instance', w), w * 4)
  table.write('Instance', 0, held, instanceWords.buffer, 0)
  const oldInstances = device.createBuffer({
    size: instanceWords.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(oldInstances, 0, instanceWords)
  const side = Math.ceil(Math.sqrt(count)),
    cast = rays(rayCount, side, seed)
  const now = await walk(device, NEW_WALK, cast, {
    proxy,
    worlds: table.view,
    tree: treeTable.view,
  })
  const before = await walk(device, oldWalk(nodeWords.length), cast, {
    proxy,
    oldInstances,
    oldWorlds,
    oldTree,
  })
  oldInstances.destroy()
  table.destroy()
  treeTable.destroy()
  proxy.destroy()
  oldWorlds.destroy()
  oldTree.destroy()
  const info = await gpu.fermer()
  return { adapter: info.court, errors, now, before, tree: !!scene.packed.placementTree }
}

/** `count` cubes on a field, each wearing the cube's cut. */
function cubeField(count: number) {
  const side = Math.ceil(Math.sqrt(count)),
    cut = cubeCut(),
    worn = { primitive: { runtimeProxy: cut }, surface: surface(1) }
  const places = Array.from({ length: count }, (_, w) =>
    new G.Matrix4().makeTranslation((w % side) * 3, 0, Math.floor(w / side) * 3),
  )
  const roots = sceneRoots(scenePages(16, 2), places)
  roots.forEach((root) => (root.proxy = worn))
  return { side, packed: packDagSelection(roots) }
}

/** The engine's proxy over `count` cubes on `device`: whether it is refused, and the hits of
 *  `cast`. */
async function engineWalk(device: GPUDevice, count: number, cast: Float32Array<ArrayBuffer>) {
  const { packed } = cubeField(count)
  let refused: string | undefined
  const selection = await createGpuDagSelection(device, packed, {
    onRefused: (reason) => (refused = reason),
  })
  if (!selection) return { refused, hits: undefined }
  const proxy = selection.proxy()
  const hits =
    proxy &&
    (await walk(device, NEW_WALK, cast, {
      proxy: proxy.buffer,
      worlds: proxy.worlds,
      tree: proxy.tree,
    }))
  selection.dispose()
  return { refused, hits }
}

/** The engine's proxy over a world past one storage binding — the device reporting a binding four
 *  fifths of its placements' frame words hold, `past` the first placement past it —, and over the
 *  same world held whole. */
export async function splitWorld({ count, rayCount }: { count: number; rayCount: number }) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device, errors } = gpu
  const side = Math.ceil(Math.sqrt(count)),
    cast = rays(rayCount, side, 7)
  const whole = await engineWalk(device, count, cast)
  const past = ceilDiv(count * 4, 5)
  const split = await engineWalk(reporting(device, past * FRAME_ROW_WORDS * 4), count, cast)
  const info = await gpu.fermer()
  return { adapter: info.court, errors, whole, split, past }
}
