import { sameElements } from '../../math/matrixElements.ts';
import { MOVE_MOVING, MOVE_NONE, MOVE_PROMOTED } from '../../placement/update.ts';
import {
  MOBILITY_CORNER_SHIFT,
  MOBILITY_CUTOUT,
  MOBILITY_MOVING,
} from '../../gpu/shadow/cullShader.ts';

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
 * whole when a placement turns moving, and on the rows the page table rewrites otherwise. The
 * policy is weighed against rejoining the layer in `docs/SHADOWS.md` (#993).
 */
export function createShadowMobility() {
  let moving = new Uint8Array(0),
    /** The pose each placement was last seen at, from the layout on: a write that leaves it where
     *  it stands — a sleeping body's pose copied again, a row inside a written range — is no
     *  move. */
    poses = new Float64Array(0),
    rows = new Uint32Array(0),
    /** Rows whose word carries `MOBILITY_CUTOUT`. */
    cutouts = 0,
    anyMoving = false,
    wholeRows = true;
  return {
    /** True once a placement has moved: the pool then keeps a static layer. */
    get layered() {
      return anyMoving;
    },
    /** True once placement `rank` has moved: the static layer does not hold it. */
    moves: (rank: number) => moving[rank] === 1,
    /** The pose placement `rank` was last seen at, a view of the state; none past the placements
     *  it is sized for. */
    poseOf: (rank: number) =>
      rank >= 0 && rank < moving.length ? poses.subarray(rank * 16, rank * 16 + 16) : undefined,
    /** True while a row is a cutout: without one, no region's cutout list holds a caster. */
    get hasCutouts() {
      return cutouts > 0;
    },
    /** One word per row: `MOBILITY_MOVING` for a row of a moving placement, `MOBILITY_CUTOUT` for
     *  one whose fragments can be cut, and its corners above `MOBILITY_CORNER_SHIFT`
     *  (`../../gpu/shadow/cullShader.ts`). */
    get rowWords() {
      return rows;
    },
    /** Sizes the state for `placements` roots and `drawSlots` rows; a new layout starts still, at
     *  the poses `worldOf` gives. Placements that joined in place
     *  (`../../placement/webgpuGrowth.ts`) start still beside the others, which keep their state,
     *  and so do they all when the table grows (`../row/grow.ts`): its row words are written anew. */
    ensure(placements: number, drawSlots: number, worldOf: (rank: number) => ArrayLike<number>) {
      if (moving.length === placements && rows.length === drawSlots) return;
      const kept = Math.min(moving.length, placements);
      const held = { moving, poses };
      if (moving.length !== placements) {
        moving = new Uint8Array(placements);
        poses = new Float64Array(placements * 16);
        moving.set(held.moving.subarray(0, kept));
        poses.set(held.poses.subarray(0, kept * 16));
        for (let rank = kept; rank < placements; rank++) poses.set(worldOf(rank), rank * 16);
      }
      if (rows.length === Math.max(1, drawSlots)) return;
      rows = new Uint32Array(Math.max(1, drawSlots));
      cutouts = 0;
      wholeRows = true;
    },
    /**
     * Placement `rank` was posed at `world`: it moved unless `world` is the pose it was last seen
     * at, or whatever its pose when `forced` — a row taken or parked, a node moved. Returns
     * `MOVE_NONE`, `MOVE_MOVING` — it was moving already, its static casters stay — or
     * `MOVE_PROMOTED`, its first move.
     */
    move(rank: number, world: ArrayLike<number>, forced = false) {
      if (rank < 0 || rank >= moving.length) return MOVE_PROMOTED;
      if (!forced && sameElements(poses, world, rank * 16)) return MOVE_NONE;
      poses.set(world, rank * 16);
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
     * lives in the transmittance layer, which a restored page starts again from. A row `cutout`
     * says is filed with the casters drawn with the fragment test (#965); a blended caster's never
     * is: the transmittance pass reads the other list alone. `corners` is the count a row draws,
     * what its region's command is sized by (#966).
     */
    writeRows(
      placementOf: (row: number) => number,
      rowCount: number,
      from: number,
      to: number,
      push: (first: number, count: number) => void,
      corners: (row: number) => number,
      alwaysMoving = rowCount,
      cutout: (row: number) => boolean = () => false,
    ) {
      if (wholeRows) {
        from = 0;
        to = rowCount - 1;
        wholeRows = false;
      }
      const last = Math.min(to, rows.length - 1);
      if (last < from) return;
      for (let row = from; row <= last; row++) {
        const placement = placementOf(row),
          blended = row >= alwaysMoving,
          moves = blended || (placement >= 0 && moving[placement] === 1),
          flags = (moves ? MOBILITY_MOVING : 0) | (!blended && cutout(row) ? MOBILITY_CUTOUT : 0),
          word = (corners(row) << MOBILITY_CORNER_SHIFT) | flags;
        cutouts += +((flags & MOBILITY_CUTOUT) !== 0) - +((rows[row] & MOBILITY_CUTOUT) !== 0);
        rows[row] = word;
      }
      push(from, last - from + 1);
    },
  };
}

export type ShadowMobility = ReturnType<typeof createShadowMobility>;
