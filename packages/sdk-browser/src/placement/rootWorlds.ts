/**
 * EVERY ROOT'S WORLD ON THE GPU, IN DOUBLES: the one world the passes derive a root's and a row's
 * words from — the root boxes pass (`rootBoxes.ts`), the tree's leaves (`treeLeaves.ts`), the rows
 * pass (`rowWordsWgsl.ts`). A root no parent composes has its world sent by the CPU, sixteen
 * doubles — 128 bytes — once it moved (`rootWorldSends.ts`); a root a parent composes has it written
 * by the compose worlds pass (`gpuComposeEncode.ts`), never by the CPU. Each root's local box goes up
 * once, when the tables are sent whole or the root is new: a move sends its world alone, never a box
 * nor a word a row of it holds. The world boxes are the root boxes pass's alone.
 *
 * Every send names the roots it moved twice, for the two passes that derive from them: the rows
 * pass and the root boxes pass, each taking its list when it runs (`takeMoved`). A root the running
 * cut took in place before it joins the session (`webgpuGrowth.ts`) is sent at its rank and named
 * to the root boxes pass alone, which writes its stretch before the cut reads it: the stretch is
 * never the host's. The tables are sized by the roots, grown by the one rule (`grownLength`) and
 * copied on the GPU, so what the GPU wrote — a composed world, a world box — survives a growth; a
 * table made, or one whose rows were all written again (`tableEpoch`), sends every root.
 */
import { clamp } from '../../../math/src/scalar/reals.ts'
import { grownLength } from '../../../math/src/sequence/resized.ts'
import { grownByCopy } from '../gpu/core/tableGrowth.ts'
import { createChangedRuns } from '../webgpu/residency/ranges.ts'
import { joinedRanges, joinedSpans } from '../gpu/dag/runWrites.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { LazyComputePass } from '../gpu/core/lazyComputePass.ts'
import { movedList, noteMoved } from './rootMoves.ts'
import {
  cutRoots,
  ROOT_BOX_WORDS,
  ROOT_LOCAL_WORDS,
  ROOT_WORLD_WORDS,
  sendLocals,
  sendSpan,
} from './rootWorldSends.ts'

function createRootWorlds() {
  return {
    worlds: undefined as GPUBuffer | undefined,
    boxes: undefined as GPUBuffer | undefined,
    locals: undefined as GPUBuffer | undefined,
    /** Roots the tables hold; the session's roots sent so far, one past them is new; and the roots
     *  sent in all, those the running cut took in place included (`cutRoots`): the one count every
     *  pass over the roots runs over — the rows, the root boxes, the tree's leaves, the transparent
     *  entries —, so a root taken in place has its leaf and stretch on the frame the cut takes it. */
    capacity: 0,
    sent: 0,
    held: 0,
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
    /** The roots' one compute pass and the maker of its command buffer, made at the first write
     *  (`rootPasses.ts`). */
    pass: undefined as { open: LazyComputePass; encoder: () => GPUCommandEncoder } | undefined,
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

/** The tables at `roots` roots, grown when they no longer hold them by the one growth's release
 *  (`grownByCopy`): the roots held so far copied on the GPU into the new ones — worlds the
 *  composition wrote and boxes the root boxes pass derived among them —, never zeroed nor sent
 *  again, and the old ones retired, freed after the frame's submit that may still name them. */
function ensureTables(device: GPUDevice, held: RootWorlds, roots: number) {
  if (held.worlds && held.capacity >= roots) return
  const capacity = grownLength(held.capacity, Math.max(1, roots)),
    usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const table = (label: string, words: number) =>
    device.createBuffer({ label, size: capacity * words * 4, usage })
  const worlds = table('Trillion3D root worlds', ROOT_WORLD_WORDS),
    boxes = table('Trillion3D root world boxes', ROOT_BOX_WORDS),
    locals = table('Trillion3D root local boxes', ROOT_LOCAL_WORDS)
  const old = [held.worlds, held.boxes, held.locals],
    kept = held.worlds ? held.held : 0
  const copy = (encoder: GPUCommandEncoder) => {
    encoder.copyBufferToBuffer(old[0]!, 0, worlds, 0, kept * ROOT_WORLD_WORDS * 4)
    encoder.copyBufferToBuffer(old[1]!, 0, boxes, 0, kept * ROOT_BOX_WORDS * 4)
    encoder.copyBufferToBuffer(old[2]!, 0, locals, 0, kept * ROOT_LOCAL_WORDS * 4)
  }
  held.worlds = worlds
  held.boxes = boxes
  held.locals = locals
  held.capacity = capacity
  grownByCopy(device, old, kept ? copy : undefined, 'Trillion3D root worlds growth')
}

/** The ranks `[from, to)`. */
const ranksFrom = (from: number, to: number) =>
  Int32Array.from({ length: to - from }, (_, k) => from + k)

/** Roots `[from, to)`, past the session's, that the running cut took in place: their worlds and
 *  local boxes sent at their ranks, and named to the root boxes pass, which writes their stretch
 *  into the cut's frame words before it reads them. The rows pass names them once they join. */
function sendTaken(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  if (to <= from) return
  sendSpan(rt, device, from, to - 1)
  sendLocals(rt, device, from, to)
  const held = rt.rootWorlds!
  noteMoved(held.roots, ranksFrom(from, to))
}

/** Roots `[from, roots)` new since the last send, named to the rows pass; those the running cut
 *  took in place before they joined (`[from, held.held)`, `sendTaken`) were sent and named to the
 *  root boxes pass then: the others alone are sent and named to it. */
function sendNew(rt: WebgpuPagesRuntime, device: GPUDevice, held: RootWorlds, from: number) {
  const roots = rt.layout.selectionRoots.length,
    taken = clamp(held.held, from, roots)
  noteMoved(held.rows, ranksFrom(from, roots))
  if (taken === roots) return
  sendSpan(rt, device, taken, roots - 1)
  sendLocals(rt, device, taken, roots)
  noteMoved(held.roots, ranksFrom(taken, roots))
}

/**
 * The worlds that moved since the last send, sent, and named to the passes that derive from them;
 * every root, its local box with it, when the tables are sent whole — made, or a table whose rows
 * were all written again; the roots the running cut took in place since, sent (`sendTaken`). Each
 * frame before its rows go up (`rowWords.ts`), and before every cut (`rootPasses.ts`): a world the
 * CPU moved since is on the GPU before anything reads it.
 */
export function sendRootWorlds(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const held = rootWorldsOf(rt),
    roots = rt.layout.selectionRoots.length,
    all = cutRoots(rt),
    { tableEpoch } = rt.layout.rows
  ensureTables(device, held, all)
  if (held.epoch !== tableEpoch) held.whole = true
  if (held.whole) {
    held.whole = false
    held.epoch = tableEpoch
    held.moved.take()
    if (all) sendSpan(rt, device, 0, all - 1)
    sendLocals(rt, device, 0, all)
    held.sent = roots
    held.held = all
    for (const list of [held.rows, held.roots]) list.whole = true
    return
  }
  if (roots > held.sent) sendNew(rt, device, held, held.sent)
  // Those taken in place before: still at their ranks, sent; a cut that dropped them, none held.
  sendTaken(rt, device, clamp(held.held, roots, all), all)
  held.sent = roots
  held.held = all
  if (!held.moved.count) return
  // Joined by the engine's one rule (`joinedRanges`): scattered moves are a few writes, each
  // rewriting at most a few roots between them, which the host holds as they stand.
  const moved = held.moved.take(),
    runs = joinedRanges(moved, moved.length, ROOT_WORLD_WORDS)
  for (let r = 0; r < runs; r++) {
    const from = joinedSpans[r * 2]
    if (from < all) sendSpan(rt, device, from, Math.min(joinedSpans[r * 2 + 1], all - 1))
  }
  noteMoved(held.rows, moved)
  noteMoved(held.roots, moved)
}
