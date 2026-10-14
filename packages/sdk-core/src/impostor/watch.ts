/**
 * THE IMPOSTOR VERDICTS KEPT FROM ONE VIEW TO THE NEXT: the engine's one impostor switch
 * (`switchTable.ts`, `switchesAt`), read again for a root only once the view may have changed it.
 *
 * The switch holds for a pivot at distance `d` and view depth `z` when `z²/d ≥ z_tex` and
 * `z·√(z/d) ≥ z_tri` (`switchTable.ts`, `switchesAt`): with `u` the pivot's direction and `f` the
 * view's forward axis, when `g = |f·u| − c(d) ≥ 0`, `c(d) = max(√(z_tex/d), (z_tri/d)^⅔)`. So:
 * - below `d = max(z_tex, z_tri)` it never holds (`OFF`);
 * - from `d_on` on it holds for every direction whose root can reach the image (`ON`): the frustum's
 *   widest direction from its axis (`impostorViewCosine`) widened by the angle the root's sphere
 *   spans about its pivot, `asin(ρ/d)`; a root out of view keeps that verdict, which draws nothing
 *   there either way;
 * - between the two (`BAND`) it is the switch's own verdict, `g`'s sign.
 * Between two reads the eye moves by `τ` and the forward axis by `φ` (a chord): `d` by at most `τ`,
 * and, while `τ ≤ d/4`, `g` by at most `φ + 4τ/d` (`|Δu| ≤ 2τ/d`, `|Δc| ≤ 1.08·τ/d`). An `OFF` or
 * `ON` root keeps its verdict until `τ` reaches its slack, its distance to its class's bounds; a
 * `BAND` root until `φ + κτ`, `κ ≥ 4/d` a power of two, reaches `|g|` or `κ` times its distance
 * to the band's bounds. Each root waits in one heap of its measure — `τ`, or `φ + κτ` — keyed by
 * its slack less the measure at its read, both taken from an anchor (an eye and an axis), and is
 * read again once the measure from that anchor passes its key: the view's displacement, not its
 * path, so a camera swaying about a place reads nothing it already read but what nears its switch.
 * A root holds one place in one heap (the engine's one, `heap.ts`), moved as it is read again:
 * the heaps never hold more than the roots. Every read takes the switch's numbers and test
 * (`readRoot`, `switchesAt`): a root in view holds the switch's verdict, bit for bit. The modules
 * it reads with: what it holds (`watchState.ts`), where its roots wait (`watchHeaps.ts`) and one
 * root's read (`watchRead.ts`).
 *
 * Cost per update: zero for an unchanged view; else O(H + P·log n) for the H heaps of the anchors
 * and the P roots whose slack the view spent or that moved. Roots appended to the list are read
 * alone; a new root list, section, focal length or frustum shape, or a view no longer rigid, reads
 * every root once.
 */
import { dotVector3, keepNumbers } from '../../../math/src/vector/vector.ts'
import { createHeap } from '../../../math/src/sequence/heap.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import type { ImpostorSection } from '../contracts/impostor.ts'
import { bakedLookup } from './baked.ts'
import { switchTable, switchTableBytes, type ImpostorRoot } from './switchTable.ts'
import { createState, waiting, type HeapMaker, type State } from './watchState.ts'
import { leave } from './watchHeaps.ts'
import { read, readEvery, takeSpent } from './watchRead.ts'

/**
 * The cosine of the widest direction `projection`'s frustum holds from its axis, its edges widened
 * by one part in a hundred for the jitter: 0 — no root ever `ON` — for a projection other than a
 * perspective one.
 */
export function impostorViewCosine(projection: ArrayLike<number>) {
  if (projection[11] === 0 || projection[15] !== 0) return 0
  const x = (1.01 * (1 + Math.abs(projection[8]))) / Math.abs(projection[0]),
    y = (1.01 * (1 + Math.abs(projection[9]))) / Math.abs(projection[5])
  return 1 / Math.sqrt(1 + x * x + y * y)
}

/** A watch over the switch of every root: `update` each image, `touch` a root that moved. Each
 *  bucket's roots wait in a heap `makeHeap` makes. */
export function createImpostorWatch(makeHeap: HeapMaker = createHeap<number>) {
  const s = createState(makeHeap)
  return {
    /** 1 at a switched root. */
    get switched() {
      return s.switched
    },
    /** The ranks whose verdict the last update changed, `changed[0 .. changedCount)`. */
    get changed() {
      return s.changed
    },
    get changedCount() {
      return s.changedCount
    },
    /** Bytes of the per-root tables — its own and its switch table's — and the heaps: what the
     *  roots hold, never what they did. */
    get hostBytes() {
      return (
        (s.table ? switchTableBytes(s.table) : 0) +
        s.switched.byteLength +
        s.readAt.byteLength +
        s.key.byteLength +
        s.at.byteLength +
        s.bucket.byteLength +
        s.slack.byteLength +
        s.bound.byteLength +
        s.boundOf.byteLength +
        8 * (s.home.length + waiting(s))
      )
    },
    /** Root `rank`'s world radius, as the switch took it. */
    radiusOf: (rank: number) => s.table!.radius[rank],
    /** Root `rank` moved, or may take a card or not: read at the next update. */
    touch: (rank: number) => void s.touched.push(rank),
    /** The verdicts at `view` (world to view, rigid), the focal length `focal` in pixels and the
     *  frustum cosine `cos` (`impostorViewCosine`); `carded` false keeps a root from its card. */
    update(
      roots: readonly ImpostorRoot[],
      section: ImpostorSection | undefined,
      view: ArrayLike<number>,
      focal: number,
      cos: number,
      carded?: (rank: number) => boolean,
    ) {
      s.changedCount = 0
      s.frame++
      const was = s.table
      if (roots !== was?.roots || section !== was?.section || focal !== was?.focal || cos !== s.cos)
        s.every = true
      if (focal !== was?.focal || cos !== s.cos) s.bound.fill(NaN)
      // A list grown in place: the roots appended are read, the others keep their verdict; one
      // shortened is read whole.
      const held = s.count
      if (roots.length < held) s.every = true
      if (roots.length !== held) fit(s, roots.length)
      s.cos = cos
      // One reading a watch, its fields set each update: nothing made an image.
      const reading = s.reading
      reading.view = view
      reading.byMesh = bakedLookup(section)
      s.table = switchTable(was, roots, section, focal)
      reading.carded = carded
      const moved = !keepNumbers(s.view, view)
      eyeOf(view, s.eye)
      for (let k = 0; k < 3; k++) s.forward[k] = view[4 * k + 2]
      if (s.every || (moved && !rigid(view))) return readEvery(s, reading)
      for (let rank = held; rank < roots.length; rank++) read(s, reading, rank)
      for (const rank of s.touched) if (rank < roots.length) read(s, reading, rank)
      s.touched.length = 0
      if (moved) takeSpent(s, reading)
    },
  }
}

/** The per-root arrays at `n` roots, each verdict and place kept; a root past `n` leaves its heap
 *  and its verdict. The arrays are the capacity (`resized`): a list grown root by root is copied a
 *  logarithmic number of times. */
function fit(s: State, n: number) {
  for (let rank = n; rank < s.count; rank++) leave(s, rank)
  if (n < s.count) {
    s.switched.fill(0, n, s.count)
    s.bound.fill(NaN, n, s.count)
  }
  s.switched = resized(s.switched, n)
  s.readAt = resized(s.readAt, n)
  s.key = resized(s.key, n)
  s.at = resized(s.at, n)
  s.bucket = resized(s.bucket, n)
  s.slack = resized(s.slack, n)
  s.bound = resized(s.bound, n, NaN)
  s.boundOf = resized(s.boundOf, n * 3)
  s.home.length = n
  s.count = n
}

/** The eye of a rigid world-to-view matrix, column-major: `−Rᵀt`. */
function eyeOf(view: ArrayLike<number>, out: Float64Array) {
  for (let j = 0; j < 3; j++) out[j] = -dotVector3(view, view, 4 * j, 12)
}

/** Whether `view`'s linear part is a rotation: then view depth and distance are the world's. */
function rigid(view: ArrayLike<number>) {
  const dot = (i: number, j: number) =>
    view[i] * view[j] + view[i + 4] * view[j + 4] + view[i + 8] * view[j + 8]
  for (let i = 0; i < 3; i++)
    for (let j = i; j < 3; j++) if (Math.abs(dot(i, j) - (i === j ? 1 : 0)) > 1e-9) return false
  return true
}
