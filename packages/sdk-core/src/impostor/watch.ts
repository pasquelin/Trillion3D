/**
 * THE IMPOSTOR VERDICTS KEPT FROM ONE VIEW TO THE NEXT: `planImpostors`' switch, read again for a
 * root only once the view may have changed it.
 *
 * The switch holds for a pivot at distance `d` and view depth `z` when `z²/d ≥ z_tex` and
 * `z·√(z/d) ≥ z_tri` (`switchTable.ts`, `switchesAt`): with `u` the pivot's direction and `f` the
 * view's forward axis, when `g = |f·u| − c(d) ≥ 0`, `c(d) = max(√(z_tex/d), (z_tri/d)^⅔)`. So:
 * - below `d = max(z_tex, z_tri)` it never holds (`OFF`);
 * - past `d* = max(z_tex/c², z_tri/c^1.5)`, `c` the cosine of the widest direction the frustum holds
 *   (`impostorViewCosine`), it holds for every direction in view (`ON`): a root out of view keeps
 *   that verdict, which draws nothing there either way;
 * - between the two (`BAND`) it is the plan's verdict, `g`'s sign.
 * Between two reads the eye moves by `τ` and the forward axis by `φ` (a chord): `d` by at most `τ`,
 * and, while `τ ≤ d/4`, `g` by at most `φ + 4τ/d` (`|Δu| ≤ 2τ/d`, `|Δc| ≤ 1.08·τ/d`). An `OFF` or
 * `ON` root keeps its verdict until `τ` reaches its slack, its distance to its class's bounds; a
 * `BAND` root until `φ + κτ`, `κ ≥ 4/d` a power of two, reaches `|g|` or `κ` times its distance
 * to the band's bounds. Each root waits in a heap of its measure — `τ`, or `φ + κτ` — keyed by its
 * slack less the measure at its read, both taken from an anchor (an eye and an axis), and is read
 * again once the measure from that anchor passes its key: the view's displacement, not its path,
 * so a camera swaying about a place reads nothing it already read but what nears its switch. Every
 * read takes the plan's numbers and switch (`readRoot`, `switchesAt`): a root in view holds the
 * plan's verdict, bit for bit.
 *
 * Cost per update: zero for an unchanged view; else O(H + P·log n) for the H heaps of the anchors
 * and the P roots whose slack the view spent. A new root list, section, focal length or frustum
 * shape, or a view no longer rigid, reads every root once.
 */
import { hypot3 } from '../../../math/src/float/hypot.ts'
import type { ImpostorSection } from '../contracts/impostor.ts'
import type { ImpostorRoot } from './plan.ts'
import { bakedLookup, point, readRoot, switchesAt, switchTable } from './switchTable.ts'
import { createSlackHeap, type SlackHeap } from './slackHeap.ts'

/** The relative margin each class bound keeps from the switch's own, far past its rounding. */
const SAFE = 1e-9
/** Anchors kept at most: the newest two merge past it. */
const ANCHORS = 16
/** The heap of the roots whose measure is the eye's travel alone: `OFF` and `ON` ones. */
const TRAVEL = 1 << 10

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

/** An eye and a forward axis, and per measure the heap of the roots keyed from them: `TRAVEL`'s,
 *  or band bucket `j`'s, whose measure is `φ + 2^j·τ`. */
type Anchor = { eye: Float64Array; forward: Float64Array; heaps: Map<number, SlackHeap> }

function createState() {
  return {
    holder: {},
    roots: undefined as readonly ImpostorRoot[] | undefined,
    section: undefined as ImpostorSection | undefined,
    focal: NaN,
    cos: NaN,
    view: new Float64Array(16).fill(NaN),
    eye: new Float64Array(3),
    forward: new Float64Array(3),
    frame: 0,
    switched: new Uint8Array(0),
    stamp: new Uint32Array(0),
    readAt: new Uint32Array(0),
    anchors: [] as Anchor[],
    changed: new Int32Array(8),
    changedCount: 0,
    touched: [] as number[],
    table: undefined as ReturnType<typeof switchTable> | undefined,
    every: true,
    reads: 0,
  }
}

type State = ReturnType<typeof createState>
type Reading = {
  view: ArrayLike<number>
  byMesh: ReturnType<typeof bakedLookup>
  table: ReturnType<typeof switchTable>
  carded?: (rank: number) => boolean
}

/** A watch over the switch of every root: `update` each image, `touch` a root that moved. */
export function createImpostorWatch() {
  const s = createState()
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
    /** Roots the last update read. */
    get reads() {
      return s.reads
    },
    /** Root `rank`'s world radius, as the switch took it. */
    radiusOf: (rank: number) => s.table!.radius[rank],
    /** Root `rank` moved, or may take a card or not: read at the next update. */
    touch: (rank: number) => void s.touched.push(rank),
    /** Every root read at the next update. */
    touchAll: () => void (s.every = true),
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
      s.reads = s.changedCount = 0
      s.frame++
      if (roots !== s.roots || roots.length !== s.switched.length) fit(s, roots.length)
      if (roots !== s.roots || section !== s.section || focal !== s.focal || cos !== s.cos)
        s.every = true
      // Roots appended or taken off the same list: every root read again, the verdicts kept.
      if (roots.length !== s.roots?.length) s.every = true
      Object.assign(s, { roots, section, focal, cos })
      const reading: Reading = {
        view,
        byMesh: bakedLookup(section),
        table: (s.table = switchTable(s.holder, roots, section, focal)),
        carded,
      }
      const moved = !sameView(s.view, view)
      s.view.set(view as ArrayLike<number>)
      eyeOf(view, s.eye)
      for (let k = 0; k < 3; k++) s.forward[k] = view[4 * k + 2]
      if (s.every || (moved && !rigid(view))) return readEvery(s, reading)
      for (const rank of s.touched) if (rank < roots.length) read(s, reading, rank)
      s.touched.length = 0
      if (moved) takeSpent(s, reading)
    },
  }
}

export type ImpostorWatch = ReturnType<typeof createImpostorWatch>

/** The per-root arrays at `n` roots, each verdict kept. */
function fit(s: State, n: number) {
  const keep = <T extends Uint8Array | Uint32Array>(from: T) => {
    const next = new (from.constructor as new (length: number) => T)(n)
    next.set(from.subarray(0, Math.min(n, from.length)))
    return next
  }
  s.switched = keep(s.switched)
  s.stamp = keep(s.stamp)
  s.readAt = new Uint32Array(n)
}

function sameView(held: Float64Array, view: ArrayLike<number>) {
  for (let k = 0; k < 16; k++) if (held[k] !== view[k]) return false
  return true
}

/** The eye of a rigid world-to-view matrix, column-major: `−Rᵀt`. */
function eyeOf(view: ArrayLike<number>, out: Float64Array) {
  for (let j = 0; j < 3; j++)
    out[j] = -(view[4 * j] * view[12] + view[4 * j + 1] * view[13] + view[4 * j + 2] * view[14])
}

/** Whether `view`'s linear part is a rotation: then view depth and distance are the world's. */
function rigid(view: ArrayLike<number>) {
  const dot = (i: number, j: number) =>
    view[i] * view[j] + view[i + 4] * view[j + 4] + view[i + 8] * view[j + 8]
  for (let i = 0; i < 3; i++)
    for (let j = i; j < 3; j++) if (Math.abs(dot(i, j) - (i === j ? 1 : 0)) > 1e-9) return false
  return true
}

const anchorAt = (s: State): Anchor => ({
  eye: Float64Array.from(s.eye),
  forward: Float64Array.from(s.forward),
  heaps: new Map(),
})

/** The eye's travel and the forward axis's chord between two views, each an eye and an axis. */
const gap = { travel: 0, chord: 0 }
function apart(eye: Float64Array, forward: Float64Array, to: Anchor) {
  const e = to.eye,
    f = to.forward
  gap.travel = hypot3(eye[0] - e[0], eye[1] - e[1], eye[2] - e[2])
  gap.chord = hypot3(forward[0] - f[0], forward[1] - f[1], forward[2] - f[2])
  return gap
}

/** Heap `bucket`'s measure over `gap`. */
const measure = (bucket: number, { travel, chord }: typeof gap) =>
  bucket === TRAVEL ? travel : chord + 2 ** bucket * travel

/** Every root read, one anchor at the view. */
function readEvery(s: State, reading: Reading) {
  s.every = false
  s.touched.length = 0
  s.anchors = [anchorAt(s)]
  for (let rank = 0; rank < s.roots!.length; rank++) read(s, reading, rank)
}

/** The roots whose slack the view spent since their anchor, read again. */
function takeSpent(s: State, reading: Reading) {
  // The anchors before this update's reads: one they make stands at the view, nothing due there.
  for (const anchor of s.anchors.slice()) {
    for (const [bucket, heap] of anchor.heaps) {
      const spent = measure(bucket, apart(s.eye, s.forward, anchor))
      while (heap.min < spent) {
        heap.pop()
        if (heap.stamp === s.stamp[heap.rank]) read(s, reading, heap.rank)
      }
      if (!heap.size) anchor.heaps.delete(bucket)
    }
  }
  // An emptied anchor is no longer read; the newest stays, the one keys are taken from.
  const newest = s.anchors[s.anchors.length - 1]
  s.anchors = s.anchors.filter((anchor) => anchor.heaps.size || anchor === newest)
  while (s.anchors.length > ANCHORS) mergeNewest(s)
}

/** Sets root `rank`'s verdict, noting it when it changed. */
function setVerdict(s: State, rank: number, on: boolean) {
  const value = on ? 1 : 0
  if (s.switched[rank] === value) return
  s.switched[rank] = value
  if (s.changedCount === s.changed.length) {
    const next = new Int32Array(s.changed.length * 2)
    next.set(s.changed)
    s.changed = next
  }
  s.changed[s.changedCount++] = rank
}

/** Root `rank` read at the view: its verdict, and the heap it waits in. */
function read(s: State, reading: Reading, rank: number) {
  if (s.readAt[rank] === s.frame) return
  s.readAt[rank] = s.frame
  s.reads++
  s.stamp[rank]++
  const { table } = reading,
    entry = readRoot(
      table,
      rank,
      s.roots![rank],
      reading.byMesh,
      reading.view,
      reading.carded?.(rank) !== false,
    )
  // A root no impostor may replace waits for nothing: only a touch reads it again.
  if (!entry) return setVerdict(s, rank, false)
  const a = table.texelDepth[rank],
    b = table.triangleDepth[rank],
    c = s.cos,
    d = hypot3(point[0], point[1], point[2])
  const never = Math.max(a, b) * (1 - SAFE),
    always = c > 0 ? Math.max(a / (c * c), b / (c * Math.sqrt(c))) * (1 + SAFE) : Infinity
  if (d < never) {
    setVerdict(s, rank, false)
    return wait(s, rank, TRAVEL, never - d)
  }
  if (d > always) {
    setVerdict(s, rank, true)
    return wait(s, rank, TRAVEL, d - always)
  }
  setVerdict(s, rank, switchesAt(a, b, point))
  const g = Math.abs(point[2]) / d - Math.max(Math.sqrt(a / d), Math.cbrt((b / d) ** 2)),
    bucket = Math.ceil(Math.log2(4 / d)),
    bounds = Math.min(d - never, always - d, d / 4)
  wait(s, rank, bucket, Math.min(Math.abs(g) - SAFE, 2 ** bucket * bounds))
}

/** Root `rank` waits in heap `bucket` until its measure from where the view stands reaches
 *  `slack`: keyed on the newest anchor, or on a new one at the view when that anchor's measure
 *  would spend half the slack. */
function wait(s: State, rank: number, bucket: number, slack: number) {
  slack = Math.max(0, slack)
  let anchor = s.anchors[s.anchors.length - 1]
  let spent = measure(bucket, apart(s.eye, s.forward, anchor))
  if (spent > slack / 2 && spent > 0) {
    anchor = anchorAt(s)
    s.anchors.push(anchor)
    spent = 0
  }
  let heap = anchor.heaps.get(bucket)
  if (!heap) anchor.heaps.set(bucket, (heap = createSlackHeap()))
  heap.push(slack - spent, rank, s.stamp[rank])
}

/** The anchor before the newest emptied into it, each key lowered by the measure between the two
 *  anchors: an entry leaves no later than it would have. */
function mergeNewest(s: State) {
  const [before, newest] = s.anchors.slice(-2),
    between = apart(newest.eye, newest.forward, before)
  for (const [bucket, heap] of before.heaps) {
    let into = newest.heaps.get(bucket)
    if (!into) newest.heaps.set(bucket, (into = createSlackHeap()))
    heap.drainInto(into, measure(bucket, between))
  }
  s.anchors.splice(s.anchors.length - 2, 1)
}
