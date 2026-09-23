import { MAX_SHADOW_SLICES, POINT_FACES } from '../light/contracts.ts';
import {
  MAX_PAGE_ROWS,
  SHADOW_MASK_BYTES,
  clearFace,
  markExtentStrips,
  maskBase,
  rowSpan,
  setRect,
} from './pages.ts';

const FACES = MAX_SHADOW_SLICES * POINT_FACES;
const strip = new Uint8Array(MAX_PAGE_ROWS);

/**
 * Which physical pages of each face hold a depth of the face's current extent — what the
 * shadow read may sample. It is not the stale mask: a page awaiting a redraw for a moved
 * node, or for a change of representation released at a camera stop, still holds a valid
 * depth of that extent and is read until its redraw lands. Only an extent restart or a slid
 * strip empties pages; a drawn region fills them. Allocated once, in physical pages; the
 * two words of a face are its eight row bytes read four by four, low row first, exactly
 * what the slice buffer carries per face.
 */
export function createShadowHeld() {
  const held = new Uint8Array(SHADOW_MASK_BYTES);
  const words = new Uint32Array(held.buffer);
  /** Faces whose mask changed since the last publication: the only ones worth a rewrite. */
  const changed = new Uint8Array(FACES);
  const touch = (slice: number, face: number) => {
    changed[slice * POINT_FACES + face] = 1;
  };
  return {
    row: (slice: number, face: number, row: number) => held[maskBase(slice, face) + row],
    /** Word `index` of the face mask: rows `4·index` to `4·index + 3`. */
    word: (slice: number, face: number, index: number) =>
      words[(maskBase(slice, face) >> 2) + index],
    touch,
    /** True once after a change: the caller publishes the mask and the flag drops. */
    take(slice: number, face: number) {
      const index = slice * POINT_FACES + face;
      if (!changed[index]) return false;
      changed[index] = 0;
      return true;
    },
    /** The extent restarts, or the slice is reset: nothing holds it anymore. */
    clearFace(slice: number, face: number) {
      clearFace(held, maskBase(slice, face));
      touch(slice, face);
    },
    /** The strips that entered with a slide by `(dx, dy)`: they hold the far side's depth. */
    clearStrips(
      slice: number,
      face: number,
      rows: number,
      wx: number,
      wy: number,
      dx: number,
      dy: number,
    ) {
      strip.fill(0);
      markExtentStrips(strip, 0, rows, wx, wy, dx, dy);
      const base = maskBase(slice, face);
      for (let row = 0; row < MAX_PAGE_ROWS; row++) held[base + row] &= ~strip[row];
      touch(slice, face);
    },
    /** A physical rectangle was drawn. */
    setRect(slice: number, face: number, x0: number, x1: number, y0: number, y1: number) {
      setRect(held, maskBase(slice, face), x0, x1, y0, y1, true);
      touch(slice, face);
    },
    /**
     * The rectangle's draw was refused: its pages hold what they held before admission,
     * `low` and `high` being the two face words the region recorded before its draw.
     */
    restoreRect(
      slice: number,
      face: number,
      x0: number,
      x1: number,
      y0: number,
      y1: number,
      low: number,
      high: number,
    ) {
      const base = maskBase(slice, face),
        span = rowSpan(x0, x1);
      for (let row = y0; row <= y1; row++) {
        const before = (row < 4 ? low >>> (row * 8) : high >>> ((row - 4) * 8)) & 0xff;
        held[base + row] = (held[base + row] & ~span) | (before & span);
      }
      touch(slice, face);
    },
  };
}
