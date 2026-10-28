import {
  createMobilityState,
  ensureLayout,
  holdsPose,
  clearArrivals,
  hasArrivals,
  parkRank,
  rearriveAll,
  sendArrivals,
  touchRank,
} from './mobilityState.ts'
import {
  followLead,
  invalidateRank,
  moveLeadSlot,
  moveRank,
  settleMoving,
} from './mobilityMoves.ts'
import { writeRootWords } from './mobilityWrite.ts'
import { MOBILITY_DEFORMS } from '../mobilityBits.ts'

/** What the shadow mobility answers of its state: the placements that move, their poses and the counts and words written. */
function mobilityReaders(s: ReturnType<typeof createMobilityState>) {
  return {
    moves: (rank: number) => s.moving[rank] === 1,
    cachedDynamic: (rank: number) =>
      s.moving[rank] === 1 || (s.words[rank] & MOBILITY_DEFORMS) !== 0,
    poseOf: (rank: number) =>
      rank >= 0 && rank < s.moving.length ? s.poses.subarray(rank * 16, rank * 16 + 16) : undefined,
    /** Whether a placement still moves in the cache's eyes, to turn static after the frames without a move (`settle`): the images drawn count
     *  that age, so a view held before it ends would keep the caster cached as dynamic for good. */
    get settling() {
      return s.movingList.length > 0
    },
    get words() {
      return s.words
    },
    get disable() {
      return s.disable
    },
    get reach() {
      return s.reach
    },
    /** How many placements stand for a first-person object (`MOBILITY_WORLD_SPACE`), as the words
     *  last written hold them. */
    get worldSpace() {
      return s.worldSpace
    },
    /** The placements touched and not yet written (`writeRoots`). */
    get touched() {
      return s.changed.count
    },
    holds: (rank: number, world: ArrayLike<number>, box?: ArrayLike<number>) =>
      holdsPose(s, rank, world, box),
  }
}

/** What the shadow mobility does to its state: ensures, moves, follows and writes. */
function mobilityActions(s: ReturnType<typeof createMobilityState>) {
  return {
    ensure: (placements: number, worldOf: (rank: number) => ArrayLike<number>) =>
      ensureLayout(s, placements, worldOf),
    move: (rank: number, world: ArrayLike<number>, forced = false) =>
      moveRank(s, rank, world, forced),
    /** The placement was updated where it stands (`invalidateRank`). */
    invalidate: (rank: number) => invalidateRank(s, rank),
    follow: (rank: number, lead: number) => followLead(s, rank, lead),
    moveLead: (lead: number, ranks: readonly number[]) => moveLeadSlot(s, lead, ranks),
    settle: (threshold: number) => settleMoving(s, threshold),
    touch: (rank: number) => touchRank(s, rank),
    /** The placement is parked or taken away: its state goes back to static (`parkRank`). */
    park: (rank: number) => parkRank(s, rank),
    /** The placement's row is seated on another mesh: the primitive is removed and a new one added, its state per view and its cache
     *  entries starting clear — it leaves the scene (`parkRank`) and its word is written again, which is its arrival (`arriveRank`).
     *  The diff then names the box it left, in the layer it was cached in, and the box it enters (`castDiffWgsl.ts`), whatever the
     *  boxes are: a mesh of the same world box leaves no old shadow in the cached pages. */
    reseat(rank: number) {
      parkRank(s, rank)
      touchRank(s, rank)
    },
    /** The placements that arrived and whose cache state per view the diff has not cleared yet, a bit
     *  each (`arriveRank`). */
    get arrivals() {
      return s.arrivals
    },
    hasArrivals: () => hasArrivals(s),
    /** The words of the arrivals the buffer the diff reads does not hold, to `write` (`sendArrivals`). */
    sendArrivals: (
      whole: boolean,
      write: (first: number, words: Uint32Array<ArrayBuffer>) => void,
    ) => sendArrivals(s, whole, write),
    /** The diff ran its state per view over the arrivals: they are told (`clearArrivals`). */
    clearArrivals: () => clearArrivals(s),
    /** Every placement arrives again at the next `writeRoots` (`rearriveAll`). */
    rearrive: () => rearriveAll(s),
    /** Every word is written again at the next `writeRoots`: the buffer they go to was made anew. */
    rewrite: () => void (s.wholeWords = true),
    writeRoots: writeRootWords.bind(null, s),
  }
}

/**
 * WHICH PLACEMENTS MOVE, as the shadow pages see them: the reference's per-primitive cache state
 * (cached as dynamic or as static, the frame of its last invalidation), kept for each placement — a
 * root of the cut. A placement becomes moving the first time it moves: from then on the static slice
 * of the virtual shadow maps leaves it out, and its later moves redraw only the dynamic slice of
 * the pages they cross. The first move is the one that changes the static slice, so it stales those
 * pages whole.
 *
 * A moving placement that has not moved for `settle`'s threshold of frames turns static again (100
 * frames, the reference's own): with the receiver mask, every dynamic page is drawn again each
 * frame, so a resting dynamic caster would cost its pages forever. What the GPU reads is one word a
 * placement (`MOBILITY_*`, `../mobilityBits.ts`): the words of the placements whose mobility or
 * casting changed (`touch`) are written again, them alone.
 *
 * Its members: `moves(rank)`, whether placement `rank` has moved: the static layer does not hold
 * it; `cachedDynamic(rank)`, whether it is cached as dynamic: it has moved, or a deformation moves
 * its vertices (the sign of the boxes the CPU declares); `poseOf(rank)`, the pose it was last seen at, a view of the state, none past the placements it
 * is sized for; `words`, one word a placement; `arrivals`, the placements that arrived since the diff last ran
 * over them, a bit each, with `hasArrivals`, `sendArrivals` and `clearArrivals`; `holds`, `ensure`, `move`, `invalidate`, `follow`,
 * `moveLead`, `settle`, `touch`, `park`, `rearrive` and `writeRoots`, those of
 * `mobilityState.ts`, `mobilityMoves.ts` and `mobilityWrite.ts`.
 */
export function createShadowMobility() {
  const s = createMobilityState()
  // The readers' getters stay live: their descriptors are carried over, not their values.
  return Object.defineProperties(
    mobilityActions(s),
    Object.getOwnPropertyDescriptors(mobilityReaders(s)),
  ) as ReturnType<typeof mobilityActions> & ReturnType<typeof mobilityReaders>
}

export type ShadowMobility = ReturnType<typeof createShadowMobility>
