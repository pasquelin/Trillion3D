/**
 * Where the impostor watch's roots wait (`watch.ts`): one heap a measure on each anchor, a root in
 * one place at most, moved as it is read again; anchors and heaps let go are kept for the next.
 */
import { distanceVector3 } from '../../../math/src/vector/vector.ts'
import { TRAVEL, type Anchor, type State } from './watchState.ts'

/** An anchor at the view, a spare one if any. */
export function anchorAt(s: State): Anchor {
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
export function letGo(s: State, anchor: Anchor) {
  for (const heap of anchor.heaps.values()) {
    heap.clear()
    s.spareHeaps.push(heap)
  }
  anchor.heaps.clear()
  s.spareAnchors.push(anchor)
}

/** The eye's travel and the forward axis's chord between two views, each an eye and an axis. */
const gap = { travel: 0, chord: 0 }
export function apart(eye: Float64Array, forward: Float64Array, to: Anchor) {
  gap.travel = distanceVector3(eye, to.eye)
  gap.chord = distanceVector3(forward, to.forward)
  return gap
}

/** Heap `bucket`'s measure over `gap`. */
export const measure = (bucket: number, { travel, chord }: typeof gap) =>
  bucket === TRAVEL ? travel : chord + 2 ** bucket * travel

/** Root `rank` out of its heap, if in one. */
export function leave(s: State, rank: number) {
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
        s.makeHeap(
          (a, b) => s.key[a] < s.key[b],
          (rank, at) => void (s.at[rank] = at),
        )),
    )
  return heap
}

/** Root `rank` waits in heap `bucket` until its measure from where the view stands reaches
 *  `slack`: keyed on the newest anchor, or on a new one at the view when that anchor's measure
 *  would spend half the slack. Its one place moves there. */
export function wait(s: State, rank: number, bucket: number, slack: number) {
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
}

/** The second-oldest anchor emptied into the oldest, each key lowered by the measure between the
 *  two: an entry leaves no later than it would have. The old anchors hold what the view left
 *  behind, few roots each; the newest, which the reads fill, is never merged. */
export function mergeOldest(s: State) {
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
    }
  }
  letGo(s, from)
  s.anchors.splice(1, 1)
}
