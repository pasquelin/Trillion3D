/**
 * THE IMPOSTOR VERDICTS KEPT FROM ONE VIEW TO THE NEXT: `planImpostors`' switch, read again for a
 * root only once the view may have changed it.
 *
 * The switch holds for a pivot at distance `d` and view depth `z` when `z²/d ≥ z_tex` and
 * `z·√(z/d) ≥ z_tri` (`switchTable.ts`, `switchesAt`): with `u` the pivot's direction and `f` the
 * view's forward axis, when `g = |f·u| − c(d) ≥ 0`, `c(d) = max(√(z_tex/d), (z_tri/d)^⅔)`. So:
 * - below `d = max(z_tex, z_tri)` it never holds (`OFF`);
 * - from `d_on` on it holds for every direction whose root can reach the image (`ON`): the frustum's
 *   widest direction from its axis (`impostorViewCosine`) widened by the angle the root's sphere
 *   spans about its pivot, `asin(ρ/d)`; a root out of view keeps that verdict, which draws nothing
 *   there either way;
 * - between the two (`BAND`) it is the plan's verdict, `g`'s sign.
 * Between two reads the eye moves by `τ` and the forward axis by `φ` (a chord): `d` by at most `τ`,
 * and, while `τ ≤ d/4`, `g` by at most `φ + 4τ/d` (`|Δu| ≤ 2τ/d`, `|Δc| ≤ 1.08·τ/d`). An `OFF` or
 * `ON` root keeps its verdict until `τ` reaches its slack, its distance to its class's bounds; a
 * `BAND` root until `φ + κτ`, `κ ≥ 4/d` a power of two, reaches `|g|` or `κ` times its distance
 * to the band's bounds. Each root waits in one heap of its measure — `τ`, or `φ + κτ` — keyed by
 * its slack less the measure at its read, both taken from an anchor (an eye and an axis), and is
 * read again once the measure from that anchor passes its key: the view's displacement, not its
 * path, so a camera swaying about a place reads nothing it already read but what nears its switch.
 * A root holds one place in one heap (the engine's one, `heap.ts`), moved as it is read again:
 * the heaps never hold more than the roots. Every read takes the plan's numbers and switch
 * (`readRoot`, `switchesAt`): a root in view holds the plan's verdict, bit for bit.
 *
 * Cost per update: zero for an unchanged view; else O(H + P·log n) for the H heaps of the anchors
 * and the P roots whose slack the view spent or that moved. Roots appended to the list are read
 * alone; a new root list, section, focal length or frustum shape, or a view no longer rigid, reads
 * every root once.
 */
import { distanceVector3, keepNumbers, length3 } from '../../../math/src/vector/vector.ts'
import { HALF_PI } from '../../../math/src/constants.ts'
import { createHeap } from '../../../math/src/sequence/heap.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import type { ImpostorSection } from '../contracts/impostor.ts'
import type { ImpostorRoot } from './plan.ts'
import { bakedLookup, point, readRoot, switchesAt, switchTable } from './switchTable.ts'

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

type Heap = ReturnType<typeof createHeap<number>>
/** An eye and a forward axis, and per measure the heap of the roots keyed from them: `TRAVEL`'s,
 *  or band bucket `j`'s, whose measure is `φ + 2^j·τ`. */
type Anchor = { eye: Float64Array; forward: Float64Array; heaps: Map<number, Heap> }

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
    /** Roots the watch holds: those of the list it last read. */
    count: 0,
    switched: new Uint8Array(0),
    readAt: new Uint32Array(0),
    /** Each root's key, place and heap, and the heap and slack it waits with. */
    key: new Float64Array(0),
    at: new Int32Array(0),
    home: [] as (Heap | undefined)[],
    bucket: new Int32Array(0),
    slack: new Float64Array(0),
    anchors: [] as Anchor[],
    /** Anchors and heaps let go, taken again before any is made: none made a frame. */
    spareAnchors: [] as Anchor[],
    spareHeaps: [] as Heap[],
    changed: new Int32Array(8),
    changedCount: 0,
    touched: [] as number[],
    table: undefined as ReturnType<typeof switchTable> | undefined,
    /** Each root's `ON` bound and the three numbers it was taken from — its switch depths and
     *  sphere —, taken again when one changes; NaN for a new focal length or frustum. */
    bound: new Float64Array(0),
    boundOf: new Float64Array(0),
    every: true,
    reads: 0,
    /** Places taken in the heaps this update: a root waiting again, or an old anchor's merged. */
    pushes: 0,
    reading: {} as Reading,
  }
}

type State = ReturnType<typeof createState>

/** Roots waiting in the heaps of `s`. */
function waiting(s: State) {
  let size = 0
  for (const anchor of s.anchors) for (const heap of anchor.heaps.values()) size += heap.size
  return size
}
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
    /** Places the last update took in the heaps: never more than its reads and an old anchor's. */
    get pushes() {
      return s.pushes
    },
    /** Bytes of the per-root tables and the heaps: what the roots hold, never what they did. */
    get hostBytes() {
      return (
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
    /** Roots waiting in the heaps: never more than the roots. */
    get waiting() {
      return waiting(s)
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
      s.reads = s.changedCount = s.pushes = 0
      s.frame++
      if (roots !== s.roots || section !== s.section || focal !== s.focal || cos !== s.cos)
        s.every = true
      if (focal !== s.focal || cos !== s.cos) s.bound.fill(NaN)
      // A list grown in place: the roots appended are read, the others keep their verdict; one
      // shortened is read whole.
      const held = s.count
      if (roots.length < held) s.every = true
      if (roots.length !== held) fit(s, roots.length)
      s.roots = roots
      s.section = section
      s.focal = focal
      s.cos = cos
      // One reading a watch, its fields set each update: nothing made an image.
      const reading = s.reading
      reading.view = view
      reading.byMesh = bakedLookup(section)
      reading.table = s.table = switchTable(s.holder, roots, section, focal)
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

/** An anchor at the view, a spare one if any. */
function anchorAt(s: State): Anchor {
  const anchor = s.spareAnchors.pop() ?? {
    eye: new Float64Array(3),
    forward: new Float64Array(3),
    heaps: new Map(),
  }
  anchor.eye.set(s.eye)
  anchor.forward.set(s.forward)
  return anchor
}

/** `anchor` let go, its heaps emptied: each kept for the next made. */
function letGo(s: State, anchor: Anchor) {
  for (const heap of anchor.heaps.values()) {
    heap.clear()
    s.spareHeaps.push(heap)
  }
  anchor.heaps.clear()
  s.spareAnchors.push(anchor)
}

/** The eye's travel and the forward axis's chord between two views, each an eye and an axis. */
const gap = { travel: 0, chord: 0 }
function apart(eye: Float64Array, forward: Float64Array, to: Anchor) {
  gap.travel = distanceVector3(eye, to.eye)
  gap.chord = distanceVector3(forward, to.forward)
  return gap
}

/** Heap `bucket`'s measure over `gap`. */
const measure = (bucket: number, { travel, chord }: typeof gap) =>
  bucket === TRAVEL ? travel : chord + 2 ** bucket * travel

/** Every root read, one anchor at the view. */
function readEvery(s: State, reading: Reading) {
  s.every = false
  s.touched.length = 0
  for (const anchor of s.anchors) letGo(s, anchor)
  s.anchors.length = 0
  s.anchors.push(anchorAt(s))
  s.home.fill(undefined)
  for (let rank = 0; rank < s.count; rank++) read(s, reading, rank)
}

/** The roots whose slack the view spent since their anchor, read again. */
function takeSpent(s: State, reading: Reading) {
  // The anchors before this update's reads: one they make stands at the view, nothing due there.
  const before = s.anchors.length
  for (let a = 0; a < before; a++) {
    const anchor = s.anchors[a]
    for (const [bucket, heap] of anchor.heaps) {
      const spent = measure(bucket, apart(s.eye, s.forward, anchor))
      while (heap.size && s.key[heap.items[0]] < spent) {
        const rank = heap.take()!
        s.home[rank] = undefined
        // Read already this update: it waits again with the slack that read gave it.
        if (s.readAt[rank] === s.frame) wait(s, rank, s.bucket[rank], s.slack[rank])
        else read(s, reading, rank)
      }
      if (!heap.size) {
        anchor.heaps.delete(bucket)
        s.spareHeaps.push(heap)
      }
    }
  }
  // An emptied anchor is no longer read; the newest stays, the one keys are taken from.
  const { anchors } = s
  let kept = 0
  for (let a = 0; a < anchors.length; a++)
    if (anchors[a].heaps.size || a === anchors.length - 1) anchors[kept++] = anchors[a]
    else letGo(s, anchors[a])
  anchors.length = kept
  while (s.anchors.length > ANCHORS) mergeOldest(s)
}

/** Sets root `rank`'s verdict, noting it when it changed. */
function setVerdict(s: State, rank: number, on: boolean) {
  const value = on ? 1 : 0
  if (s.switched[rank] === value) return
  s.switched[rank] = value
  s.changed = resized(s.changed, s.changedCount + 1)
  s.changed[s.changedCount++] = rank
}

/**
 * The distance from which a root of switch depths `a`, `b` and sphere radius `rho` about its pivot
 * switches for every direction its sphere can reach the image from, at the frustum cosine `c`:
 * the least `x` with `x > max(a/c'², b/c'^1.5)`, `c'` the cosine of the frustum's widest angle
 * widened by `asin(rho/x)`; `Infinity` when none.
 */
function onDistance(c: number, a: number, b: number, rho: number) {
  if (c <= 0) return Infinity
  const widest = Math.acos(Math.min(1, c))
  const holds = (x: number) => {
    const angle = widest + Math.asin(Math.min(1, rho / x))
    if (angle >= HALF_PI) return false
    const cw = Math.cos(angle)
    return x > Math.max(a / (cw * cw), b / (cw * Math.sqrt(cw)))
  }
  let low = Math.max(a, b, rho),
    high = 2 * low
  for (let k = 0; !holds(high); k++) {
    if (k > 64) return Infinity
    low = high
    high *= 2
  }
  for (let k = 0; k < 60; k++) {
    const mid = (low + high) / 2
    if (holds(mid)) high = mid
    else low = mid
  }
  return high * (1 + SAFE)
}

/** Root `rank`'s `ON` bound, its sphere's reach about the pivot taken from its world and entry;
 *  kept while its switch depths and sphere stay. */
function onBound(s: State, reading: Reading, rank: number, a: number, b: number) {
  const world = s.roots![rank].world.elements,
    centre = reading.table.entries[rank]?.centre ?? [0, 0, 0]
  const offset = length3(
    world[0] * centre[0] + world[4] * centre[1] + world[8] * centre[2],
    world[1] * centre[0] + world[5] * centre[1] + world[9] * centre[2],
    world[2] * centre[0] + world[6] * centre[1] + world[10] * centre[2],
  )
  const rho = reading.table.radius[rank] + offset,
    of = s.boundOf,
    at = rank * 3
  if (Number.isNaN(s.bound[rank]) || of[at] !== a || of[at + 1] !== b || of[at + 2] !== rho) {
    s.bound[rank] = onDistance(s.cos, a, b, rho)
    of[at] = a
    of[at + 1] = b
    of[at + 2] = rho
  }
  return s.bound[rank]
}

/** Root `rank` read at the view: its verdict, and the heap it waits in. */
function read(s: State, reading: Reading, rank: number) {
  if (s.readAt[rank] === s.frame) return
  s.readAt[rank] = s.frame
  s.reads++
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
  if (!entry) {
    leave(s, rank)
    return setVerdict(s, rank, false)
  }
  const a = table.texelDepth[rank],
    b = table.triangleDepth[rank],
    d = length3(point[0], point[1], point[2])
  const never = Math.max(a, b) * (1 - SAFE),
    always = onBound(s, reading, rank, a, b)
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

/** Root `rank` out of its heap, if in one. */
function leave(s: State, rank: number) {
  const home = s.home[rank]
  if (!home) return
  home.take(s.at[rank])
  s.home[rank] = undefined
}

/** The heap of `bucket` on `anchor`, made as its first root waits there. */
function heapOf(s: State, anchor: Anchor, bucket: number) {
  let heap = anchor.heaps.get(bucket)
  if (!heap)
    anchor.heaps.set(
      bucket,
      (heap =
        s.spareHeaps.pop() ??
        createHeap<number>(
          (a, b) => s.key[a] < s.key[b],
          (rank, at) => void (s.at[rank] = at),
        )),
    )
  return heap
}

/** Root `rank` waits in heap `bucket` until its measure from where the view stands reaches
 *  `slack`: keyed on the newest anchor, or on a new one at the view when that anchor's measure
 *  would spend half the slack. Its one place moves there. */
function wait(s: State, rank: number, bucket: number, slack: number) {
  slack = Math.max(0, slack)
  s.bucket[rank] = bucket
  s.slack[rank] = slack
  let anchor = s.anchors[s.anchors.length - 1]
  let spent = measure(bucket, apart(s.eye, s.forward, anchor))
  if (spent > slack / 2 && spent > 0) {
    anchor = anchorAt(s)
    s.anchors.push(anchor)
    spent = 0
  }
  const heap = heapOf(s, anchor, bucket)
  if (s.home[rank] === heap) {
    s.key[rank] = slack - spent
    return heap.settle(s.at[rank])
  }
  leave(s, rank)
  s.key[rank] = slack - spent
  s.home[rank] = heap
  heap.push(rank)
  s.pushes++
}

/** The second-oldest anchor emptied into the oldest, each key lowered by the measure between the
 *  two: an entry leaves no later than it would have. The old anchors hold what the view left
 *  behind, few roots each; the newest, which the reads fill, is never merged. */
function mergeOldest(s: State) {
  const into = s.anchors[0],
    from = s.anchors[1],
    between = apart(into.eye, into.forward, from)
  for (const [bucket, heap] of from.heaps) {
    const target = heapOf(s, into, bucket),
      shift = measure(bucket, between)
    for (const rank of heap.items) {
      s.key[rank] -= shift
      s.home[rank] = target
      target.push(rank)
      s.pushes++
    }
  }
  letGo(s, from)
  s.anchors.splice(1, 1)
}
