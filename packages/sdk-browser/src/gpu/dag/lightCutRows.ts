import { VIEW_STATE_FRESH } from './shader/viewsWgsl.ts';

/** A view of the frame not yet given a row. */
const UNASSIGNED = 0xffffffff;

/**
 * WHICH ROW OF PER-PRIMITIVE STATE EACH LIGHT VIEW OWNS. A view carries its pruning threshold from
 * one frame to the next (`shader/floorWgsl.ts`), and its rank in a frame's cut changes with the
 * views that frame draws: keyed by rank, a view would inherit the threshold of whichever view had
 * its rank before. Keyed by the view's identity — a light's sun level or lamp face —, a view finds
 * its own row again as long as it keeps being drawn.
 *
 * A view new to the cut takes the row least recently drawn, and is told the row is fresh: it then
 * carries nothing over. A frame draws at most `capacity` views, so a row is always free.
 */
export function createLightCutRows(capacity: number) {
  const identities = new Float64Array(capacity).fill(NaN),
    drawn = new Float64Array(capacity).fill(-1),
    words = new Uint32Array(capacity);
  let frame = 0;
  return {
    /** Each view's word for the uniform block (`VIEW_STATE_WORD`), after `assign`. */
    words,
    /** Rows for the `count` views of a frame, `identity(v)` naming view `v`. */
    assign(count: number, identity: (view: number) => number) {
      frame++;
      for (let v = 0; v < count; v++) {
        const row = identities.indexOf(identity(v));
        words[v] = row < 0 ? UNASSIGNED : row;
        if (row >= 0) drawn[row] = frame;
      }
      for (let v = 0; v < count; v++) {
        if (words[v] !== UNASSIGNED) continue;
        let row = -1;
        for (let r = 0; r < capacity; r++)
          if (drawn[r] < frame && (row < 0 || drawn[r] < drawn[row])) row = r;
        identities[row] = identity(v);
        drawn[row] = frame;
        words[v] = (row | VIEW_STATE_FRESH) >>> 0;
      }
    },
  };
}
