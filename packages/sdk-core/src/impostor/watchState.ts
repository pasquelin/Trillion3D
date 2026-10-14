/**
 * What the impostor watch holds (`watch.ts`): per root its verdict, its read frame and the heap place
 * it waits in, the anchors its heaps are keyed from, and the reading of the update under way.
 */
import type { createHeap } from '../../../math/src/sequence/heap.ts'
import type { ImpostorSection } from '../contracts/impostor.ts'
import type { BakedLookup } from './baked.ts'
import type { ImpostorRoot, SwitchTable } from './switchTable.ts'

/** The relative margin each class bound keeps from the switch's own, far past its rounding. */
export const SAFE = 1e-9
/** Anchors kept at most: the oldest two merge past it (`mergeOldest`). */
export const ANCHORS = 16
/** The heap of the roots whose measure is the eye's travel alone: `OFF` and `ON` ones. */
export const TRAVEL = 1 << 10

type Heap = ReturnType<typeof createHeap<number>>
/** What makes the heap a bucket's roots wait in (`createHeap`). */
export type HeapMaker = (
  before: (a: number, b: number) => boolean,
  placed: (rank: number, at: number) => void,
) => Heap
/** An eye and a forward axis, and per measure the heap of the roots keyed from them: `TRAVEL`'s,
 *  or band bucket `j`'s, whose measure is `φ + 2^j·τ`. */
export type Anchor = { eye: Float64Array; forward: Float64Array; heaps: Map<number, Heap> }

/** A watch's state before its first update: no root held, every root to read. */
export function createState(makeHeap: HeapMaker) {
  return {
    makeHeap,
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
    table: undefined as SwitchTable | undefined,
    /** Each root's `ON` bound and the three numbers it was taken from — its switch depths and
     *  sphere —, taken again when one changes; NaN for a new focal length or frustum. */
    bound: new Float64Array(0),
    boundOf: new Float64Array(0),
    every: true,
    reading: {} as Reading,
  }
}

export type State = ReturnType<typeof createState>

/** Roots waiting in the heaps of `s`. */
export function waiting(s: State) {
  let size = 0
  for (const anchor of s.anchors) for (const heap of anchor.heaps.values()) size += heap.size
  return size
}
export type Reading = {
  view: ArrayLike<number>
  byMesh: BakedLookup
  table: SwitchTable
  carded?: (rank: number) => boolean
}
