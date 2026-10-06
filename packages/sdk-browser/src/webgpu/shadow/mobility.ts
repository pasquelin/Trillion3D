import { createMobilityState, ensureLayout, holdsPose, touchRank } from './mobilityState.ts'
import { followLead, moveLeadSlot, moveRank, settleMoving } from './mobilityMoves.ts'
import { writeMobilityRows } from './mobilityWrite.ts'

/**
 * WHICH PLACEMENTS MOVE, as the shadow pages see them. A
 * placement — a root of the cut, the rank a page-table row carries (`PageInfo.placement`) —
 * becomes moving the first time it moves: from then on the static slice of the virtual shadow
 * maps leaves it out, and its later moves redraw only the dynamic slice of the pages they cross.
 * The first move is the one that changes the static slice, so it stales those pages whole.
 *
 * A moving placement that has not moved for `settle`'s threshold of frames turns static again
 * (100 frames): with the receiver mask, every dynamic page is drawn again each frame, so a
 * resting dynamic caster would cost its pages forever. What the GPU reads is one word per row: the rows the page table rewrites, and
 * the rows of the placements whose mobility or casting changed (`touch`) — the dirty
 * primitive upload, never the whole table for one placement.
 *
 * Its members: `moves(rank)`, whether placement `rank` has moved: the static layer does not hold
 * it; `poseOf(rank)`, the pose it was last seen at, a view of the state, none past the placements
 * it is sized for; `rowWords`, one word per row: `MOBILITY_MOVING` for a row of a moving
 * placement, `MOBILITY_CUTOUT` for one whose fragments can be cut, `MOBILITY_SHADOWLESS` for one
 * that casts no shadow, and its corners above `MOBILITY_CORNER_SHIFT`
 * (`../../gpu/shadow/mobilityBits.ts`); `holds`, `ensure`, `move`, `follow`, `moveLead`, `settle`,
 * `touch` and `writeRows`, those of `mobilityState.ts`, `mobilityMoves.ts` and
 * `mobilityWrite.ts`.
 */
export function createShadowMobility() {
  const s = createMobilityState()
  return {
    moves: (rank: number) => s.moving[rank] === 1,
    poseOf: (rank: number) =>
      rank >= 0 && rank < s.moving.length ? s.poses.subarray(rank * 16, rank * 16 + 16) : undefined,
    get rowWords() {
      return s.rows
    },
    holds: (rank: number, world: ArrayLike<number>, box?: ArrayLike<number>) =>
      holdsPose(s, rank, world, box),
    ensure: (placements: number, drawSlots: number, worldOf: (rank: number) => ArrayLike<number>) =>
      ensureLayout(s, placements, drawSlots, worldOf),
    move: (rank: number, world: ArrayLike<number>, forced = false) =>
      moveRank(s, rank, world, forced),
    follow: (rank: number, lead: number) => followLead(s, rank, lead),
    moveLead: (lead: number, ranks: readonly number[]) => moveLeadSlot(s, lead, ranks),
    settle: (threshold: number, turnedStatic: (rank: number, lead: number) => void) =>
      settleMoving(s, threshold, turnedStatic),
    touch: (rank: number) => touchRank(s, rank),
    writeRows: writeMobilityRows.bind(null, s),
  }
}

export type ShadowMobility = ReturnType<typeof createShadowMobility>
