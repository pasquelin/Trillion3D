/**
 * EVERY ROOT'S WORLD ON THE GPU, IN DOUBLES: the one world the rows pass derives a row's words from
 * (`rowWordsWgsl.ts`). A root no parent composes has its world sent by the CPU, sixteen doubles —
 * 128 bytes — the frame after it moved, and its world box beside it, which its rows' detail reads
 * the radius of its object from; a root a parent composes has both written by the compose worlds
 * pass (`gpuCompose.ts`), never by the CPU. A move costs the CPU the root's 176 bytes, never a word
 * a row of it holds.
 *
 * The tables are sized by the roots, grown by the one rule (`grownLength`); a table made again, a
 * growth, or a table whose rows were all written again (`tableEpoch`) sends every root.
 */
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { grownLength, resized } from '../../../math/src/sequence/resized.ts'
import { createChangedRuns } from '../webgpu/residency/ranges.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { NONE } from './gpuComposeWgsl.ts'

/** Words of a root's world, sixteen doubles, and of its world box, six. */
const ROOT_WORLD_WORDS = 32,
  ROOT_BOX_WORDS = 12
/** Roots one write sends at most: the scratch a run is packed in stays this size. */
const RUN_ROOTS = 1024

function createRootWorlds() {
  return {
    worlds: undefined as GPUBuffer | undefined,
    boxes: undefined as GPUBuffer | undefined,
    /** Roots the tables hold. */
    capacity: 0,
    /** Roots whose world moved since the last send. */
    moved: createChangedRuns(),
    /** Every root is sent at the next send; the table's age it last sent them at. */
    whole: true,
    epoch: -1,
    worldWords: new Uint32Array(0),
    boxWords: new Uint32Array(0),
  }
}
export type RootWorlds = ReturnType<typeof createRootWorlds>

/** The runtime's root worlds, made at their first use. */
const rootWorldsOf = (rt: Pick<WebgpuPagesRuntime, 'rootWorlds'>) =>
  (rt.rootWorlds ??= createRootWorlds())

/** The tables, destroyed with the session. */
export function disposeRootWorlds(rt: Pick<WebgpuPagesRuntime, 'rootWorlds'>) {
  rt.rootWorlds?.worlds?.destroy()
  rt.rootWorlds?.boxes?.destroy()
  rt.rootWorlds = undefined
}

/** Root `rank`'s world moved: sent at the next send, and its rows derived again (`rowWords.ts`). */
export function noteRootWorld(rt: Pick<WebgpuPagesRuntime, 'rootWorlds'>, rank: number) {
  rootWorldsOf(rt).moved.mark(rank)
}

/** Whether a parent composes root `rank`: the compose worlds pass writes its world. */
const composed = (rt: Pick<WebgpuPagesRuntime, 'compose'>, rank: number) =>
  !!rt.compose && rank < rt.compose.roots && rt.compose.parentOf[rank] !== NONE

/** The tables at the roots' count, made again — every root sent — when they no longer hold them. */
function ensureTables(device: GPUDevice, held: RootWorlds, roots: number) {
  if (held.worlds && held.capacity >= roots) return
  const capacity = grownLength(held.capacity, Math.max(1, roots)),
    usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  held.worlds?.destroy()
  held.boxes?.destroy()
  held.worlds = device.createBuffer({
    label: 'Trillion3D root worlds',
    size: capacity * ROOT_WORLD_WORDS * 4,
    usage,
  })
  held.boxes = device.createBuffer({
    label: 'Trillion3D root world boxes',
    size: capacity * ROOT_BOX_WORDS * 4,
    usage,
  })
  held.capacity = capacity
  held.whole = true
}

/** Roots `[from, to]`, none composed, packed and sent in one write each table. */
function sendRun(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  const held = rt.rootWorlds!,
    roots = rt.layout.selectionRoots,
    count = to - from + 1
  held.worldWords = resized(held.worldWords, count * ROOT_WORLD_WORDS)
  held.boxWords = resized(held.boxWords, count * ROOT_BOX_WORDS)
  held.boxWords.fill(0, 0, count * ROOT_BOX_WORDS)
  for (let k = 0; k < count; k++) {
    const root = roots[from + k]
    packDoubles(held.worldWords, k * ROOT_WORLD_WORDS, root.world.elements, 0, 16)
    const box = root.worldBox
    if (box && box[3] >= box[0]) packDoubles(held.boxWords, k * ROOT_BOX_WORDS, box, 0, 6)
  }
  const queue = device.queue
  queue.writeBuffer(
    held.worlds!,
    from * ROOT_WORLD_WORDS * 4,
    held.worldWords,
    0,
    count * ROOT_WORLD_WORDS,
  )
  queue.writeBuffer(
    held.boxes!,
    from * ROOT_BOX_WORDS * 4,
    held.boxWords,
    0,
    count * ROOT_BOX_WORDS,
  )
}

/** Roots `[from, to]` sent, the composed ones left to the GPU: runs of neighbours none composes,
 *  a run `RUN_ROOTS` roots at most. */
function sendSpan(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  let first = -1
  for (let rank = from; rank <= to; rank++) {
    if (composed(rt, rank)) {
      if (first >= 0) sendRun(rt, device, first, rank - 1)
      first = -1
      continue
    }
    if (first < 0) first = rank
    else if (rank - first === RUN_ROOTS) {
      sendRun(rt, device, first, rank - 1)
      first = rank
    }
  }
  if (first >= 0) sendRun(rt, device, first, to)
}

/**
 * The worlds that moved since the last send, sent; the roots whose rows are derived again: those
 * moved, increasing, or every root (`undefined`) when the tables were sent whole — made again, a
 * growth, a table whose rows were all written again.
 */
export function sendRootWorlds(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const held = rootWorldsOf(rt),
    roots = rt.layout.selectionRoots.length,
    { tableEpoch } = rt.layout.rows
  ensureTables(device, held, roots)
  if (held.epoch !== tableEpoch) held.whole = true
  if (held.whole) {
    held.whole = false
    held.epoch = tableEpoch
    held.moved.take()
    if (roots) sendSpan(rt, device, 0, roots - 1)
    return undefined
  }
  if (!held.moved.count) return EMPTY
  const moved = held.moved.take()
  for (let k = 0; k < moved.length;) {
    const from = moved[k]
    let to = from
    while (++k < moved.length && moved[k] === to + 1) to = moved[k]
    if (to < roots) sendSpan(rt, device, from, to)
    else if (from < roots) sendSpan(rt, device, from, roots - 1)
  }
  return moved
}

const EMPTY = new Int32Array(0)
