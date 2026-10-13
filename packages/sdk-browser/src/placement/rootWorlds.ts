/**
 * EVERY ROOT'S WORLD ON THE GPU, IN DOUBLES: the one world the passes derive a root's and a row's
 * words from — the root boxes pass (`rootBoxes.ts`), the tree's leaves (`treeLeaves.ts`), the rows
 * pass (`rowWordsWgsl.ts`). A root no parent composes has its world sent by the CPU, sixteen
 * doubles — 128 bytes — once it moved; a root a parent composes has it written by the compose worlds
 * pass (`gpuComposeEncode.ts`), never by the CPU. Each root's local box goes up once, when the
 * tables are sent whole or the root is new: a move sends its world alone, never a box nor a word a
 * row of it holds. The world boxes are the root boxes pass's alone.
 *
 * Every send names the roots it moved twice, for the two passes that derive from them: the rows
 * pass (`takeMovedRows`) and the root boxes pass (`takeMovedRoots`), each taking its list when it
 * runs. The tables are sized by the roots, grown by the one rule (`grownLength`); a table made
 * again, a growth, or a table whose rows were all written again (`tableEpoch`) sends every root.
 */
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { grownLength, resized } from '../../../math/src/sequence/resized.ts'
import { createChangedRuns } from '../webgpu/residency/ranges.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { NONE } from './gpuComposeWgsl.ts'
import { movedList, noteMoved } from './rootMoves.ts'

/** Words of a root's world, sixteen doubles; of its world box, six; of its local box, six doubles
 *  and whether it has one (`rootBoxesWgsl.ts`). */
const ROOT_WORLD_WORDS = 32,
  ROOT_BOX_WORDS = 12,
  ROOT_LOCAL_WORDS = 14
/** Roots one write sends at most: the scratch a run is packed in stays this size. */
const RUN_ROOTS = 1024

function createRootWorlds() {
  return {
    worlds: undefined as GPUBuffer | undefined,
    boxes: undefined as GPUBuffer | undefined,
    locals: undefined as GPUBuffer | undefined,
    /** Roots the tables hold, and the roots sent so far: one past them is new. */
    capacity: 0,
    sent: 0,
    /** Roots whose world moved since the last send. */
    moved: createChangedRuns(),
    /** Every root is sent at the next send; the table's age it last sent them at. */
    whole: true,
    epoch: -1,
    worldWords: new Uint32Array(0),
    localWords: new Uint32Array(0),
    /** What the rows pass and the root boxes pass have still to derive. */
    rows: movedList(),
    roots: movedList(),
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
  rt.rootWorlds?.locals?.destroy()
  rt.rootWorlds = undefined
}

/** Root `rank`'s world moved: sent at the next send, and its box and rows derived again. */
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
  disposeRootWorlds({ rootWorlds: held })
  const table = (label: string, words: number) =>
    device.createBuffer({ label, size: capacity * words * 4, usage })
  held.worlds = table('Trillion3D root worlds', ROOT_WORLD_WORDS)
  held.boxes = table('Trillion3D root world boxes', ROOT_BOX_WORDS)
  held.locals = table('Trillion3D root local boxes', ROOT_LOCAL_WORDS)
  held.capacity = capacity
  held.whole = true
}

/** Roots `[from, to]`, none composed, their worlds packed and sent in one write. */
function sendRun(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  const held = rt.rootWorlds!,
    roots = rt.layout.selectionRoots,
    count = to - from + 1
  held.worldWords = resized(held.worldWords, count * ROOT_WORLD_WORDS)
  for (let k = 0; k < count; k++)
    packDoubles(held.worldWords, k * ROOT_WORLD_WORDS, roots[from + k].world.elements, 0, 16)
  const at = from * ROOT_WORLD_WORDS * 4
  device.queue.writeBuffer(held.worlds!, at, held.worldWords, 0, count * ROOT_WORLD_WORDS)
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

/** The local boxes of roots `[from, roots)`, sent: a root's own, read and never written, and
 *  whether it has a world box at all — the root boxes pass carries the one by its world. */
function sendLocals(rt: WebgpuPagesRuntime, device: GPUDevice, from: number) {
  const held = rt.rootWorlds!,
    roots = rt.layout.selectionRoots,
    count = roots.length - from
  if (count <= 0) return
  held.localWords = resized(held.localWords, count * ROOT_LOCAL_WORDS)
  held.localWords.fill(0, 0, count * ROOT_LOCAL_WORDS)
  for (let k = 0; k < count; k++) {
    const { localBox, worldBox } = roots[from + k]
    if (!localBox || !worldBox || !(localBox[3] >= localBox[0])) continue
    packDoubles(held.localWords, k * ROOT_LOCAL_WORDS, localBox, 0, 6)
    held.localWords[k * ROOT_LOCAL_WORDS + 12] = 1
  }
  const at = from * ROOT_LOCAL_WORDS * 4
  device.queue.writeBuffer(held.locals!, at, held.localWords, 0, count * ROOT_LOCAL_WORDS)
}

/** Roots `[from, roots)` new since the last send: their worlds and local boxes sent and named. */
function sendNew(rt: WebgpuPagesRuntime, device: GPUDevice, held: RootWorlds, from: number) {
  const roots = rt.layout.selectionRoots.length
  sendSpan(rt, device, from, roots - 1)
  sendLocals(rt, device, from)
  const fresh = Int32Array.from({ length: roots - from }, (_, k) => from + k)
  noteMoved(held.rows, fresh)
  noteMoved(held.roots, fresh)
}

/**
 * The worlds that moved since the last send, sent, and named to the passes that derive from them;
 * every root, its local box with it, when the tables are sent whole — made again, a growth, a table
 * whose rows were all written again. Each frame before its rows go up (`rowWords.ts`), and before
 * every cut (`rootPasses.ts`): a world the CPU moved since is on the GPU before anything reads it.
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
    sendLocals(rt, device, 0)
    held.sent = roots
    for (const list of [held.rows, held.roots]) list.whole = true
    return
  }
  if (roots > held.sent) sendNew(rt, device, held, held.sent)
  held.sent = roots
  if (!held.moved.count) return
  const moved = held.moved.take()
  for (let k = 0; k < moved.length;) {
    const from = moved[k]
    let to = from
    while (++k < moved.length && moved[k] === to + 1) to = moved[k]
    if (from < roots) sendSpan(rt, device, from, Math.min(to, roots - 1))
  }
  noteMoved(held.rows, moved)
  noteMoved(held.roots, moved)
}
