import { sameElements } from '../../math/matrixElements.ts';
import { MOVE_MOVING, MOVE_NONE, MOVE_PROMOTED } from '../../placement/update.ts';

/**
 * WHICH PLACEMENTS MOVE, as the shadow pages see them. A placement — a root of the cut, the rank
 * a page-table row carries (`PageInfo.placement`) — becomes moving the first time it moves, and
 * stays so: from then on the static layer of the shadow pool leaves it out, and its later moves
 * redraw only the moving casters of the pages they cross. The first move is the one that changes
 * the static layer, so it stales those pages whole.
 *
 * It never turns static again: a moving placement that rests costs nothing — its pages are not
 * staled by it —, and a rule that demoted it after some stillness would redraw the static layer
 * each time an object that pauses moves again. What the GPU reads is one word per row, rewritten
 * whole when a placement turns moving, and on the rows the page table rewrites otherwise.
 */
export function createShadowMobility() {
  let moving = new Uint8Array(0),
    /** The pose each placement was last seen at, from the layout on: a write that leaves it where
     *  it stands — a sleeping body's pose copied again, a row inside a written range — is no
     *  move. */
    poses = new Float64Array(0),
    rows = new Uint32Array(0),
    anyMoving = false,
    wholeRows = true;
  return {
    /** True once a placement has moved: the pool then keeps a static layer. */
    get layered() {
      return anyMoving;
    },
    /** One word per row, 1 for a row of a moving placement. */
    get rowWords() {
      return rows;
    },
    /** Sizes the state for `placements` roots and `drawSlots` rows; a new layout starts still, at
     *  the poses `worldOf` gives. */
    ensure(placements: number, drawSlots: number, worldOf: (rank: number) => ArrayLike<number>) {
      if (moving.length === placements && rows.length === drawSlots) return;
      moving = new Uint8Array(placements);
      poses = new Float64Array(placements * 16);
      for (let rank = 0; rank < placements; rank++) poses.set(worldOf(rank), rank * 16);
      rows = new Uint32Array(Math.max(1, drawSlots));
      anyMoving = false;
      wholeRows = true;
    },
    /**
     * Placement `rank` was posed, at `world` when it is known: it moved unless `world` is the pose
     * it was last seen at, or whatever its pose when `forced` — a row taken or parked. Returns
     * `MOVE_NONE`, `MOVE_MOVING` — it was moving already, its static casters stay — or
     * `MOVE_PROMOTED`, its first move.
     */
    move(rank: number, world?: ArrayLike<number>, forced = false) {
      if (rank < 0 || rank >= moving.length) return MOVE_PROMOTED;
      // A move said without its pose leaves none to compare the next write with.
      if (!world) poses[rank * 16] = NaN;
      else if (!forced && sameElements(poses, world, rank * 16)) return MOVE_NONE;
      else poses.set(world, rank * 16);
      if (moving[rank]) return MOVE_MOVING;
      moving[rank] = 1;
      anyMoving = true;
      wholeRows = true;
      return MOVE_PROMOTED;
    },
    /**
     * Writes the row words of rows `[from, to]` — every row after a placement turned moving —
     * from each row's placement, and hands the span to push, or nothing. A row from
     * `alwaysMoving` on is a blended caster's, which the static layer never keeps: its shadow
     * lives in the transmittance layer, which a restored page starts again from.
     */
    writeRows(
      placementOf: (row: number) => number,
      rowCount: number,
      from: number,
      to: number,
      push: (first: number, count: number) => void,
      alwaysMoving = rowCount,
    ) {
      if (wholeRows) {
        from = 0;
        to = rowCount - 1;
        wholeRows = false;
      }
      const last = Math.min(to, rows.length - 1);
      if (last < from) return;
      for (let row = from; row <= last; row++) {
        const placement = placementOf(row);
        rows[row] = row >= alwaysMoving || (placement >= 0 && moving[placement]) ? 1 : 0;
      }
      push(from, last - from + 1);
    },
  };
}

export type ShadowMobility = ReturnType<typeof createShadowMobility>;
