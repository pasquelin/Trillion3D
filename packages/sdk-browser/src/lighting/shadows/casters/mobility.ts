import {
  createMobilityState,
  ensureLayout,
  holdsPose,
  parkRank,
  touchRank,
} from './mobilityState.ts'
import { followLead, moveLeadSlot, moveRank, settleMoving } from './mobilityMoves.ts'
import { writeRootWords } from './mobilityWrite.ts'
import { MOBILITY_DEFORMS } from '../mobilityBits.ts'

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
 * is sized for; `words`, one word a placement; `holds`, `ensure`, `move`, `follow`, `moveLead`,
 * `settle`, `touch`, `park` and `writeRoots`, those of `mobilityState.ts`, `mobilityMoves.ts` and
 * `mobilityWrite.ts`.
 */
export function createShadowMobility() {
  const s = createMobilityState()
  return {
    moves: (rank: number) => s.moving[rank] === 1,
    cachedDynamic: (rank: number) =>
      s.moving[rank] === 1 || (s.words[rank] & MOBILITY_DEFORMS) !== 0,
    poseOf: (rank: number) =>
      rank >= 0 && rank < s.moving.length ? s.poses.subarray(rank * 16, rank * 16 + 16) : undefined,
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
    ensure: (placements: number, worldOf: (rank: number) => ArrayLike<number>) =>
      ensureLayout(s, placements, worldOf),
    move: (rank: number, world: ArrayLike<number>, forced = false) =>
      moveRank(s, rank, world, forced),
    follow: (rank: number, lead: number) => followLead(s, rank, lead),
    moveLead: (lead: number, ranks: readonly number[]) => moveLeadSlot(s, lead, ranks),
    settle: (threshold: number) => settleMoving(s, threshold),
    touch: (rank: number) => touchRank(s, rank),
    /** The placement is parked or taken away: its state goes back to static (`parkRank`). */
    park: (rank: number) => parkRank(s, rank),
    /** Every word is written again at the next `writeRoots`: the buffer they go to was made anew. */
    rewrite: () => void (s.wholeWords = true),
    writeRoots: writeRootWords.bind(null, s),
  }
}

export type ShadowMobility = ReturnType<typeof createShadowMobility>
