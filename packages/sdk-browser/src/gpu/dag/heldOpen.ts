import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { createSortedKeys, takeSorted } from '../../webgpu/cut/denseKeys.ts'

/**
 * THE OPEN COUNTS A PLACEMENT HOLDS OF ITS OWN, beside its primitive's shared nodes.
 *
 * A primitive's culling nodes are shared by its placements (`pack.ts`), each node carrying the
 * DAG's open count with nothing resident (`NODE_OPEN`). A placement whose pages are resident moves
 * some of those counts down: a cluster whose finer group is ready closes its owner node and every
 * node above it (`../../page/cut/readiness.ts`). Those counts, and those alone, live here: one entry
 * per (placement, node) whose count differs from its node's, in a table open-addressed by both.
 *
 * Its slots are bounded by what the view holds resident — the row cache —, never by the
 * placements: the readiness only moves a count under a resident page. The count is an
 * accelerator only: a node's shared count is the largest it can take, and a larger open count never
 * prunes a subtree a smaller one would keep (`shader/floorWgsl.ts`). So an entry the table cannot
 * place — past its probe bound or its load — is left out and the node reads its shared count:
 * more of the hierarchy is walked that frame, the cut is the same.
 *
 * Three words a slot, in the readout behind its regions (`layout.ts`, `heldOpenWord`): the
 * placement plus one (zero, an empty slot), the node, the count.
 */
export const HELD_SLOT_WORDS = 3
/** The longest probe a lookup walks; the host places no entry past it. */
const HELD_PROBES = 32

/** Slots of a table holding `entries` at a load of one half at most: a power of two, within
 *  `bytes` when given — half a readout binding (`resources.ts`): a table it cannot hold whole
 *  leaves more counts at their node's, never a list short. */
export const heldOpenSlots = (entries: number, bytes = Infinity) => {
  let slots = 1
  while (slots < 2 * Math.max(1, entries) && 2 * slots * HELD_SLOT_WORDS * 4 <= bytes) slots *= 2
  return slots
}

/** The home slot of (`w`, `node`) in a table of `mask + 1` slots: the shader's `heldHash`. */
function heldHash(w: number, node: number, mask: number) {
  let h = Math.imul(w ^ Math.imul(node, 0x9e3779b1), 0x85ebca77)
  h ^= h >>> 13
  return (h >>> 0) & mask
}

/** The host's table: the words the GPU reads, the entries each placement holds, and the slots and
 *  placements a change touched since they were last taken. */
export function createHeldOpen(slots: number) {
  const mask = slots - 1,
    words = new Uint32Array(new ArrayBuffer(slots * HELD_SLOT_WORDS * 4)),
    held = new Map<number, number>(),
    touched = createSortedKeys(),
    placements = createSortedKeys()
  /** The slot holding (`w`, `node`), or the empty one ending its probe; -1 past the probe bound. */
  const find = (w: number, node: number) => {
    let s = heldHash(w, node, mask)
    for (let k = 0; k < Math.min(HELD_PROBES, slots); k++, s = (s + 1) & mask) {
      const at = s * HELD_SLOT_WORDS
      if (words[at] === 0 || (words[at] === w + 1 && words[at + 1] === node)) return s
    }
    return -1
  }
  const count = (w: number, by: number) => {
    const n = (held.get(w) ?? 0) + by
    if (n) held.set(w, n)
    else held.delete(w)
    placements.listed.add(w)
  }
  /** Slot `s` emptied: the entries behind it that may move closer to their home do (backward
   *  shift), so no probe ever crosses a hole. */
  const remove = (s: number) => {
    for (let hole = s, j = (s + 1) & mask; ; j = (j + 1) & mask) {
      const at = j * HELD_SLOT_WORDS
      if (words[at] === 0) {
        words.fill(0, hole * HELD_SLOT_WORDS, hole * HELD_SLOT_WORDS + HELD_SLOT_WORDS)
        touched.listed.add(hole)
        return
      }
      const home = heldHash(words[at] - 1, words[at + 1], mask)
      if (((j - home) & mask) >= ((j - hole) & mask)) {
        words.copyWithin(hole * HELD_SLOT_WORDS, at, at + HELD_SLOT_WORDS)
        touched.listed.add(hole)
        hole = j
      }
    }
  }
  let entries = 0,
    dropped = 0
  return {
    slots,
    words,
    /** Placement `w`'s own count at `node`, `undefined` when it reads its node's. */
    get(w: number, node: number) {
      const s = find(w, node)
      return s >= 0 && words[s * HELD_SLOT_WORDS] ? words[s * HELD_SLOT_WORDS + 2] : undefined
    },
    /** Placement `w`'s count at `node` becomes `value`, `undefined` its node's own. */
    set(w: number, node: number, value: number | undefined) {
      const s = find(w, node),
        at = s * HELD_SLOT_WORDS
      if (s >= 0 && words[at]) {
        if (value === undefined) {
          entries--
          count(w, -1)
          remove(s)
        } else if (words[at + 2] !== value) {
          words[at + 2] = value
          touched.listed.add(s)
        }
        return
      }
      if (value === undefined) return
      // No room within the probe bound or the load: the node reads its own, larger, count.
      if (s < 0 || 2 * (entries + 1) > slots) return void dropped++
      words.set([w + 1, node, value], at)
      touched.listed.add(s)
      entries++
      count(w, 1)
    },
    /** The entries placement `w` holds: the GPU probes the table for it alone when it holds one. */
    heldBy: (w: number) => held.get(w) ?? 0,
    get entries() {
      return entries
    },
    /** Entries left out for want of room since the table was made. */
    get dropped() {
      return dropped
    },
    /** The slots written since the last call, ascending. */
    takeSlots: () => takeSorted(touched),
    /** The placements whose entry count moved since the last call, ascending. */
    takePlacements: () => takeSorted(placements),
  }
}

export type HeldOpen = ReturnType<typeof createHeldOpen>

/** The kernel's lookup: placement `w`'s count at `node`, `blank` its node's own when it holds none.
 *  `heldBy` is the placement's frame word (`../worlds.ts`): a placement holding nothing reads no
 *  slot. */
export const DAG_HELD_OPEN_WGSL = wgslBlock(
  'DAG_HELD_OPEN_WGSL',
  [],
  `const HELD_PROBES:u32=${HELD_PROBES}u;
fn heldHash(w:u32,node:u32)->u32{var h=(w^(node*0x9e3779b1u))*0x85ebca77u;h^=h>>13u;return h&views[0u].heldMask;}
fn openOf(w:u32,node:u32,blank:u32)->u32{
 if(heldByOf(w)==0u){return blank;}
 var s=heldHash(w,node);
 for(var k=0u;k<HELD_PROBES;k++){
  let at=views[0u].heldBase+${HELD_SLOT_WORDS}u*s;
  let key=out.pages[at];
  if(key==0u){return blank;}
  if(key==w+1u&&out.pages[at+1u]==node){return out.pages[at+2u];}
  s=(s+1u)&views[0u].heldMask;
 }
 return blank;
}`,
)
