import { poseHoldsBox, sameElements } from '../../../../../math/src/matrix/matrixElements.ts'
import {
  MOBILITY_CACHE_STATIC,
  MOBILITY_MOVING,
  MOBILITY_OFTEN_MOVING,
  MOBILITY_SHADOWLESS,
} from '../mobilityBits.ts'
import { createChangedRuns, type ChangedRuns } from '../../../geometry/residency/ranges.ts'
import { resized } from '../../../../../math/src/sequence/resized.ts'
import { bitWords } from '../../../../../math/src/scalar/integers.ts'
import { setBit } from '../../../../../math/src/scalar/bits.ts'

/**
 * The state of `createShadowMobility`, fields of one object (`mobility.ts`): what the shadows keep
 * of each placement — a root of the cut —, as the cache of the reference keeps it of each
 * primitive.
 *
 * `moving` and `lastMoved`: whether each placement moves (its pages cached as dynamic), and the
 * `settle` frame it last moved at; `frame`: `settle` calls so far (the scene frame number);
 * `movingList`: the placements moving now, the ones `settle` walks; `changed`: the placements
 * whose word must be written again, once each (`createChangedRuns`); `poses`: the pose each placement was last
 * seen at, from the layout on — a write that leaves it where it stands, a sleeping body's pose copied
 * again, is no move; a NaN first element once a parent slot held it, unknown; `words`: one word a
 * placement (`MOBILITY_*`), what the GPU reads it by, and `disable` the distance word beside it; `wholeWords`: every word is written at the next
 * `writeRoots`; `arrived`: the first placement the layout added since the last full write, which
 * `arriveRank` weighs as it is written; `arrivals`: the placements that arrived since the diff's state
 * per view last ran over them (`clearArrivals`), a bit each (`bitWords`) — the words of it that hold a
 * set bit are `lit`, those the buffer the kernel reads does not hold yet are `unsent`
 * (`sendArrivals`); `left`: the placements parked or taken since they were last written, whose
 * return is an arrival whatever the word they were written with says. `leads`: the parent slot each placement follows on the GPU
 * (`../../../placement/compose/gpuCompose.ts`), -1 for none — it takes no CPU pose while the parent
 * moves — sized by `follow` itself, since a link may come before `ensure`; per slot, `leadMoved`
 * the `settle` frame its parent last moved at, `leadMoving` 1 once its followers were made moving.
 */
export function createMobilityState() {
  return {
    moving: new Uint8Array(0),
    lastMoved: new Uint32Array(0),
    frame: 0,
    movingList: [] as number[],
    changed: createChangedRuns(),
    poses: new Float64Array(0),
    words: new Uint32Array(0),
    /** The square of the distance past which each placement's object stops evaluating its offset,
     *  0 for never (`writeRootWords`), what the GPU reads after the words. */
    disable: new Float32Array(0),
    /** The reach of each placement's deformation (`ClusterRoot.deformReach`), the part of its mark's
     *  reach the offsets do not add: what the GPU reads after the distances (`writeRootWords`). */
    reach: new Float32Array(0),
    /** How many placements' words carry `MOBILITY_WORLD_SPACE`: whether a sun takes a first-person clipmap. */
    worldSpace: 0,
    wholeWords: true,
    arrived: 0,
    arrivals: new Uint32Array(1),
    lit: createChangedRuns(),
    unsent: createChangedRuns(1),
    left: new Uint8Array(0),
    leads: new Int32Array(0),
    leadMoved: new Uint32Array(0),
    leadMoving: new Uint8Array(0),
  }
}

export type MobilityState = ReturnType<typeof createMobilityState>

/** Placement `rank`'s word must be written again: it starts or stops casting, or is parked or
 *  taken (`MOBILITY_SHADOWLESS`). */
export function touchRank(s: MobilityState, rank: number) {
  if (rank >= 0 && rank < s.moving.length) s.changed.mark(rank)
}

/** Placement `rank` is parked or taken away: the cache state of its row goes back to static — not
 *  moving, never moved —, so that a placement that reuses the row starts as a new one. Its pose is
 *  kept: shown again where it stands it is no move. Its word is written anew by the caller, and its
 *  return is an arrival even if it comes before that write (`left`). It stays in `movingList` until
 *  `settleMoving` drops it. */
export function parkRank(s: MobilityState, rank: number) {
  if (rank < 0 || rank >= s.moving.length) return
  s.moving[rank] = 0
  s.lastMoved[rank] = 0
  s.left[rank] = 1
}

/** Placement `rank` moves at this frame: the static slice leaves it out. */
function startMoving(s: MobilityState, rank: number) {
  s.moving[rank] = 1
  s.lastMoved[rank] = s.frame
  s.movingList.push(rank)
}

/** Placement `rank` starts moving at this frame: the static slice leaves it out. */
export function promoteRank(s: MobilityState, rank: number) {
  startMoving(s, rank)
  touchRank(s, rank)
}

/** The cast flags that keep a placement out of the dynamic layer: it casts no shadow
 *  (`MOBILITY_SHADOWLESS`) or never invalidates them (`MOBILITY_CACHE_STATIC`). */
const KEEPS_STATIC = MOBILITY_SHADOWLESS | MOBILITY_CACHE_STATIC

/** Whether a placement whose word is `cast` moves often (`MOBILITY_OFTEN_MOVING`) and casts shadows
 *  that can be invalidated: neither shadowless nor pinned to its cached shadows. */
const movesOften = (cast: number) => !(cast & KEEPS_STATIC) && !!(cast & MOBILITY_OFTEN_MOVING)

/** Placement `rank`, whose word is `cast`, arrives in the scene — new in the layout, or taken from
 *  a parked row —: one that is often moving (`MOBILITY_OFTEN_MOVING`) is cached as dynamic from its
 *  first image, its first box in the dynamic layer alone, and settles to static after the frames
 *  without a move as any other does. One that casts no shadow (`MOBILITY_SHADOWLESS`), or never
 *  invalidates them (`MOBILITY_CACHE_STATIC`), does not. Every arrival is told to the diff's memory
 *  (`arrivals`): an instance added to the scene starts with no cache state in any view. Its word
 *  is written by the caller. */
export function arriveRank(s: MobilityState, rank: number, cast: number) {
  s.arrivals = resized(s.arrivals, bitWords(rank + 1))
  setBit(s.arrivals, rank)
  s.lit.mark(rank >>> 5)
  s.unsent.mark(rank >>> 5)
  if (s.moving[rank] === 1) return
  if (movesOften(cast)) startMoving(s, rank)
}

/** Whether the placement `rank` that was written with the word `was` and is now written with `cast`
 *  arrives: it casts again after it cast nothing, or after it left the scene since (`parkRank`),
 *  even between two writes. */
export const returns = (s: MobilityState, rank: number, was: number, cast: number) =>
  !(cast & MOBILITY_SHADOWLESS) && (!!(was & MOBILITY_SHADOWLESS) || s.left[rank] === 1)

/** Whether a placement arrived that the diff's state per view has not run over yet. */
export const hasArrivals = (s: MobilityState) => s.lit.count > 0

/** Hands `write` the words of `arrivals` the buffer the diff reads does not hold, from word `first`:
 *  those changed since they were last sent, or, `whole` (the buffer was made anew, zero), every word
 *  that holds a set bit. The buffer is then up to date. */
export function sendArrivals(
  s: MobilityState,
  whole: boolean,
  write: (first: number, words: Uint32Array<ArrayBuffer>) => void,
) {
  if (whole) markWords(s.lit, (word) => s.unsent.mark(word))
  const { count, pairs } = s.unsent.runs()
  for (let run = 0; run < count; run++)
    write(pairs[2 * run], s.arrivals.subarray(pairs[2 * run], pairs[2 * run + 1] + 1))
  s.unsent.clear()
}

/** Calls `visit` with each word `words` lists, in increasing order. */
function markWords(words: ChangedRuns, visit: (word: number) => void) {
  const { count, pairs } = words.runs()
  for (let run = 0; run < count; run++)
    for (let word = pairs[2 * run]; word <= pairs[2 * run + 1]; word++) visit(word)
}

/** The diff's state per view ran over the arrivals: they are told, and forgotten. The words that held
 *  them are zero in the buffer once sent. */
export function clearArrivals(s: MobilityState) {
  markWords(s.lit, (word) => {
    s.arrivals[word] = 0
    s.unsent.mark(word)
  })
  s.lit.clear()
}

/** Every placement arrives again at the next write: the state the arrival path decides on — whether
 *  it moves — is gone, as the reference makes the state of its primitives anew when it recreates
 *  their render state. */
export function rearriveAll(s: MobilityState) {
  s.moving.fill(0)
  s.lastMoved.fill(0)
  s.movingList.length = 0
  s.arrived = 0
  s.wholeWords = true
}

/** The word of a placement: moving, and how it casts (`cast`, the flags `castFlags` gave: its
 *  `MOBILITY_SHADOWLESS` and the others). A placement whose object says its
 *  transform never invalidates its shadows (`MOBILITY_CACHE_STATIC`) never moves as the shadow pages
 *  see it: its pose is not told to the static slice. */
export function rankBits(s: MobilityState, rank: number, cast: number) {
  if (rank < 0) return 0
  return (s.moving[rank] === 1 && !(cast & MOBILITY_CACHE_STATIC) ? MOBILITY_MOVING : 0) | cast
}

/** Whether `world` leaves placement `rank` where it was last seen: the same pose, or, given its
 *  local `box`, one that moves it by less than a float32 step (`poseHoldsBox`). */
export const holdsPose = (
  s: MobilityState,
  rank: number,
  world: ArrayLike<number>,
  box?: ArrayLike<number>,
) => (box ? poseHoldsBox(s.poses, world, box, rank * 16) : sameElements(s.poses, world, rank * 16))

/** The state is sized for `placements` roots: the ones that stay keep theirs, the new ones start
 *  still at the poses `worldOf` gives. */
function resizePlacements(
  s: MobilityState,
  placements: number,
  worldOf: (rank: number) => ArrayLike<number>,
) {
  const kept = Math.min(s.moving.length, placements)
  const held = { moving: s.moving, poses: s.poses, lastMoved: s.lastMoved, left: s.left }
  // Every slot's followers are weighed again at its parent's next move (`moveLead`).
  s.leadMoving.fill(0)
  s.moving = new Uint8Array(placements)
  s.poses = new Float64Array(placements * 16)
  s.lastMoved = new Uint32Array(placements)
  s.left = new Uint8Array(placements)
  s.left.set(held.left.subarray(0, kept))
  s.moving.set(held.moving.subarray(0, kept))
  s.lastMoved.set(held.lastMoved.subarray(0, kept))
  s.movingList = []
  for (let rank = 0; rank < kept; rank++) if (s.moving[rank]) s.movingList.push(rank)
  s.poses.set(held.poses.subarray(0, kept * 16))
  for (let rank = kept; rank < placements; rank++) s.poses.set(worldOf(rank), rank * 16)
  // The words of a table of another size are all written again.
  s.changed.clear()
  s.words = new Uint32Array(Math.max(1, placements))
  s.worldSpace = 0
  s.disable = new Float32Array(Math.max(1, placements))
  s.reach = new Float32Array(Math.max(1, placements))
  s.wholeWords = true
  // Placements the last resize added and no write has weighed yet stay arrivals.
  s.arrived = Math.min(s.arrived, kept)
}

/** Sizes the state for `placements` roots; a new layout starts still, at the poses `worldOf` gives,
 *  its placements arriving at the next write (`arriveRank`). The placements keep their state when the
 *  roots grow: their words are written anew. */
export function ensureLayout(
  s: MobilityState,
  placements: number,
  worldOf: (rank: number) => ArrayLike<number>,
) {
  if (s.moving.length === placements) return
  resizePlacements(s, placements, worldOf)
}
