/**
 * One read of a root by the impostor watch (`watch.ts`): its verdict by the switch, the class it
 * falls in — never, always or the band between — and the slack it waits with until the view may
 * have changed it; the reads of an update, every root or those whose slack the view spent.
 */
import { length3, transformDirectionRow } from '../../../math/src/vector/vector.ts'
import { HALF_PI } from '../../../math/src/constants.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { point, readRoot, switchesAt } from './switchTable.ts'
import { ANCHORS, SAFE, TRAVEL, type Reading, type State } from './watchState.ts'
import { anchorAt, apart, leave, letGo, measure, mergeOldest, wait } from './watchHeaps.ts'

/** Every root read, one anchor at the view. */
export function readEvery(s: State, reading: Reading) {
  s.every = false
  s.touched.length = 0
  for (const anchor of s.anchors) letGo(s, anchor)
  s.anchors.length = 0
  s.anchors.push(anchorAt(s))
  s.home.fill(undefined)
  for (let rank = 0; rank < s.count; rank++) read(s, reading, rank)
}

/** The roots whose slack the view spent since their anchor, read again. */
export function takeSpent(s: State, reading: Reading) {
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
function onBound(s: State, rank: number, a: number, b: number) {
  const table = s.table!,
    world = table.roots[rank].world.elements,
    centre = table.entries[rank]?.centre ?? [0, 0, 0]
  const x = centre[0],
    y = centre[1],
    z = centre[2]
  const offset = length3(
    transformDirectionRow(world, 0, x, y, z),
    transformDirectionRow(world, 1, x, y, z),
    transformDirectionRow(world, 2, x, y, z),
  )
  const rho = table.radius[rank] + offset,
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
export function read(s: State, reading: Reading, rank: number) {
  if (s.readAt[rank] === s.frame) return
  s.readAt[rank] = s.frame
  const table = s.table!,
    entry = readRoot(
      table,
      rank,
      table.roots[rank],
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
    always = onBound(s, rank, a, b)
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
