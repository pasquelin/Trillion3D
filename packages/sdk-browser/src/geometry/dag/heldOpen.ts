import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import * as sampling from '../../../../math/src/wgsl/sampling.ts'
import {
  halfLoadSlots,
  mixWord,
  movesIntoHole,
  slotsWithin,
} from '../../../../math/src/scalar/integers.ts'
import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { createChangedRuns } from '../residency/ranges.ts'
import { openProbeStatement } from './shader/probeWgsl.ts'

/**
 * THE OPEN COUNTS A PLACEMENT HOLDS OF ITS OWN, beside its primitive's shared nodes.
 *
 * A primitive's culling nodes are shared by its placements (`pack/pack.ts`), each node carrying the
 * DAG's open count with nothing resident (`NODE_OPEN`). A placement whose pages are resident moves
 * some of those counts down: a cluster whose finer group is ready closes its owner node and every
 * node above it (`../cut/readiness.ts`). Those counts, and those alone, live here: one entry
 * per (placement, node) whose count differs from its node's, in a table open-addressed by both.
 *
 * Its slots are bounded by what the view holds resident — the clusters its visible list has room
 * for —, never by the placements: the readiness only moves a count under a resident page. The count is an
 * accelerator only: a node's shared count is the largest it can take, and a larger open count never
 * prunes a subtree a smaller one would keep (`shader/floorWgsl.ts`). So an entry the table cannot
 * place — past its probe bound or its load — is left out and the node reads its shared count:
 * more of the hierarchy is walked that frame, the cut is the same. The host keeps it, for the table
 * the visible list's growth makes (`resize`): what the view holds, never the placements.
 *
 * Three words a slot, in the readout behind its lists (`lists/listCap.ts`, `heldOpenAt`): the
 * placement plus one (zero, an empty slot), the node, the count.
 */
export const OPEN_SLOT_WORDS = 3
/** The longest probe a lookup walks; the host places no entry past it. */
const HELD_PROBES = 32

/** Slots of a table holding `entries` at a load of one half at most: a power of two, within
 *  `bytes` when given — half a readout binding (`resources.ts`): a table it cannot hold whole
 *  leaves more counts at their node's, never a list short. */
export const heldOpenSlots = (entries: number, bytes = Infinity) =>
  clampLowWins(halfLoadSlots(entries), 1, slotsWithin(bytes, OPEN_SLOT_WORDS * 4))

/** The home slot of (`w`, `node`) in a table of `mask + 1` slots: the shader's `heldHash`. */
function heldHash(w: number, node: number, mask: number) {
  return mixWord(w ^ mixWord(node)) & mask
}

/** What the host's table holds: its slots and the words the GPU reads (`mask` is `slots - 1`), the
 *  entries each placement holds, the slots and placements a change touched since they were last
 *  taken, the counts the table had no room for, by placement then node — what a grown table
 *  places —, and how many entries it holds and left out. */
type Held = {
  slots: number
  mask: number
  words: Uint32Array<ArrayBuffer>
  held: Map<number, number>
  touched: ReturnType<typeof createChangedRuns>
  placements: ReturnType<typeof createChangedRuns>
  spill: Map<number, Map<number, number>>
  entries: number
  dropped: number
}

/** The slot holding (`w`, `node`), or the empty one ending its probe; -1 past the probe bound. */
function find(t: Held, w: number, node: number) {
  const { words, mask } = t
  let s = heldHash(w, node, mask)
  const probes = Math.min(HELD_PROBES, t.slots)
  for (let k = 0; k < probes; k++, s = (s + 1) & mask) {
    const at = s * OPEN_SLOT_WORDS
    if (words[at] === 0 || (words[at] === w + 1 && words[at + 1] === node)) return s
  }
  return -1
}

function count(t: Held, w: number, by: number) {
  const n = (t.held.get(w) ?? 0) + by
  if (n) t.held.set(w, n)
  else t.held.delete(w)
  t.placements.mark(w)
}

/** Slot `s` emptied: the entries behind it that may move closer to their home do (backward
 *  shift), so no probe ever crosses a hole. */
function remove(t: Held, s: number) {
  const { words, mask, touched } = t
  for (let hole = s, j = (s + 1) & mask; ; j = (j + 1) & mask) {
    const at = j * OPEN_SLOT_WORDS
    if (words[at] === 0) {
      words.fill(0, hole * OPEN_SLOT_WORDS, hole * OPEN_SLOT_WORDS + OPEN_SLOT_WORDS)
      touched.mark(hole)
      return
    }
    if (movesIntoHole(j, heldHash(words[at] - 1, words[at + 1], mask), hole, mask)) {
      words.copyWithin(hole * OPEN_SLOT_WORDS, at, at + OPEN_SLOT_WORDS)
      touched.mark(hole)
      hole = j
    }
  }
}

function unspill(t: Held, w: number, node: number) {
  const own = t.spill.get(w)
  if (own?.delete(node) && !own.size) t.spill.delete(w)
}

/** Placement `w`'s count at `node` becomes `value`, `undefined` its node's own. */
function setEntry(t: Held, w: number, node: number, value: number | undefined) {
  const { words } = t
  const s = find(t, w, node),
    at = s * OPEN_SLOT_WORDS
  if (s >= 0 && words[at]) {
    if (value === undefined) {
      t.entries--
      count(t, w, -1)
      remove(t, s)
    } else if (words[at + 2] !== value) {
      words[at + 2] = value
      t.touched.mark(s)
    }
    return
  }
  // A count set again supersedes the one the table had no room for.
  unspill(t, w, node)
  if (value === undefined) return
  // No room within the probe bound or the load: the node reads its own, larger, count; the
  // host keeps it for a table grown later (`resize`).
  if (s < 0 || 2 * (t.entries + 1) > t.slots) {
    t.dropped++
    const own = t.spill.get(w) ?? new Map<number, number>()
    t.spill.set(w, own.set(node, value))
    return
  }
  words[at] = w + 1
  words[at + 1] = node
  words[at + 2] = value
  t.touched.mark(s)
  t.entries++
  count(t, w, 1)
}

/** The table made again over `capacity` slots, every entry it holds and every count it had no
 *  room for placed again. */
function resizeTable(t: Held, capacity: number) {
  const old = t.words
  t.slots = capacity
  t.mask = t.slots - 1
  t.words = new Uint32Array(new ArrayBuffer(t.slots * OPEN_SLOT_WORDS * 4))
  for (const w of t.held.keys()) t.placements.mark(w)
  t.held.clear()
  t.entries = 0
  const left = [...t.spill].flatMap(([w, own]) => [...own].map(([node, v]) => [w, node, v]))
  t.spill.clear()
  for (let at = 0; at < old.length; at += OPEN_SLOT_WORDS)
    if (old[at]) setEntry(t, old[at] - 1, old[at + 1], old[at + 2])
  for (const [w, node, value] of left) setEntry(t, w, node, value)
  t.touched.clear()
}

/** The host's table: the words the GPU reads, the entries each placement holds, and the slots and
 *  placements a change touched since they were last taken. */
export function createHeldOpen(capacity: number) {
  const t: Held = {
    slots: capacity,
    mask: capacity - 1,
    words: new Uint32Array(new ArrayBuffer(capacity * OPEN_SLOT_WORDS * 4)),
    held: new Map(),
    touched: createChangedRuns(),
    placements: createChangedRuns(),
    spill: new Map(),
    entries: 0,
    dropped: 0,
  }
  return {
    get slots() {
      return t.slots
    },
    get words() {
      return t.words
    },
    /** Placement `w`'s own count at `node`, `undefined` when it reads its node's. */
    get(w: number, node: number) {
      const s = find(t, w, node)
      return s >= 0 && t.words[s * OPEN_SLOT_WORDS] ? t.words[s * OPEN_SLOT_WORDS + 2] : undefined
    },
    set: (w: number, node: number, value: number | undefined) => setEntry(t, w, node, value),
    /** The entries placement `w` holds: the GPU probes the table for it alone when it holds one. */
    heldBy: (w: number) => t.held.get(w) ?? 0,
    get entries() {
      return t.entries
    },
    /** Entries left out for want of room since the table was made. */
    get dropped() {
      return t.dropped
    },
    /** The slots written since the last call, ascending. */
    takeSlots: () => t.touched.take(),
    /** The placements whose entry count moved since the last call, ascending. */
    takePlacements: () => t.placements.take(),
    /**
     * The table made again over `capacity` slots, every entry it holds and every count it had no
     * room for placed again: what the row cache's growth asks (`queueGrowth.ts`). Its words are new, to be written whole; the
     * placements whose count moved are listed, as by `set`.
     */
    resize: (capacity: number) => resizeTable(t, capacity),
  }
}

export type HeldOpen = ReturnType<typeof createHeldOpen>

/** The kernel's lookup: placement `w`'s count at `node`, `blank` its node's own when it holds none.
 *  `heldBy` is the placement's frame word (`worlds/worlds.ts`): a placement holding nothing reads no
 *  slot. */
export const DAG_HELD_OPEN_WGSL = wgslBlock(
  'DAG_HELD_OPEN_WGSL',
  [sampling.mixWord],
  `const HELD_PROBES:u32=${HELD_PROBES}u;
fn heldHash(w:u32,node:u32)->u32{return mixWord(w^mixWord(node))&cutView.heldMask;}
fn openOf(w:u32,node:u32,blank:u32)->u32{
 if(heldByOf(w)==0u){return blank;}
${openProbeStatement({
  home: 'heldHash(w,node)',
  mask: 'cutView.heldMask',
  steps: 'HELD_PROBES',
  slotWord: (s) => `cutView.heldBase+${OPEN_SLOT_WORDS}u*${s}`,
  step: `let key=out.pages[at];
  if(key==0u){return blank;}
  if(key==w+1u&&out.pages[at+1u]==node){return out.pages[at+2u];}`,
})}
 return blank;
}`,
)
