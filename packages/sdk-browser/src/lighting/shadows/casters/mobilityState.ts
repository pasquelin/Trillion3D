import { poseHoldsBox, sameElements } from '../../../../../math/src/matrix/matrixElements.ts'
import { MOBILITY_CACHE_STATIC, MOBILITY_MOVING } from '../mobilityBits.ts'
import { createChangedRuns } from '../../../geometry/residency/ranges.ts'

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
 * `writeRoots`. `leads`: the parent slot each placement follows on the GPU
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
    /** How many placements' words carry `MOBILITY_WORLD_SPACE`: whether a sun takes a first-person clipmap. */
    worldSpace: 0,
    wholeWords: true,
    leads: new Int32Array(0),
    leadMoved: new Uint32Array(0),
    leadMoving: new Uint8Array(0),
  }
}

export type MobilityState = ReturnType<typeof createMobilityState>

/** Placement `rank`'s word must be written again: it starts or stops casting, or casting far
 *  shadows, or is parked or taken (`MOBILITY_SHADOWLESS`, `MOBILITY_FAR_SHADOW`). */
export function touchRank(s: MobilityState, rank: number) {
  if (rank >= 0 && rank < s.moving.length) s.changed.mark(rank)
}

/** Placement `rank` starts moving at this frame: the static slice leaves it out. */
export function promoteRank(s: MobilityState, rank: number) {
  s.moving[rank] = 1
  s.lastMoved[rank] = s.frame
  s.movingList.push(rank)
  touchRank(s, rank)
}

/** The word of a placement: moving, and how it casts (`castFlags`, its `MOBILITY_SHADOWLESS`,
 *  `MOBILITY_FAR_SHADOW` and the others). A placement whose object says its transform never
 *  invalidates its shadows (`MOBILITY_CACHE_STATIC`) never moves as the shadow pages see it: its pose
 *  is not told to the static slice. */
export function rankBits(s: MobilityState, rank: number, castFlags: (rank: number) => number) {
  if (rank < 0) return 0
  const cast = castFlags(rank)
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
  const held = { moving: s.moving, poses: s.poses, lastMoved: s.lastMoved }
  // Every slot's followers are weighed again at its parent's next move (`moveLead`).
  s.leadMoving.fill(0)
  s.moving = new Uint8Array(placements)
  s.poses = new Float64Array(placements * 16)
  s.lastMoved = new Uint32Array(placements)
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
  s.wholeWords = true
}

/** Sizes the state for `placements` roots; a new layout starts still, at the poses `worldOf` gives.
 *  The placements keep their state when the roots grow: their words are written anew. */
export function ensureLayout(
  s: MobilityState,
  placements: number,
  worldOf: (rank: number) => ArrayLike<number>,
) {
  if (s.moving.length === placements) return
  resizePlacements(s, placements, worldOf)
}
