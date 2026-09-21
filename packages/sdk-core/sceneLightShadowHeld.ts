import { MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';
import { SHADOW_MASK_BYTES, markExtentStrips, maskBase, setRect } from './sceneLightShadowPages.ts';

/** Page rows a face mask carries: what `maskBase` spaces two faces by. */
const FACE_BYTES = SHADOW_MASK_BYTES / (MAX_SHADOW_SLICES * POINT_FACES);
const strip = new Uint8Array(FACE_BYTES);

/**
 * Which physical pages of each face hold a depth of the face's current extent — what the
 * shadow read may sample. It is not the stale mask: a page awaiting a redraw for a moved
 * node, or for a change of representation released at a camera stop, still holds a valid
 * depth of that extent and is read until its redraw lands. Only an extent restart or a slid
 * strip empties pages; a drawn region fills them. Allocated once, in physical pages.
 */
export function createShadowHeld() {
  const held = new Uint8Array(SHADOW_MASK_BYTES);
  /** What was held before the frame's admissions: what a refused draw gives back. */
  const admitted = new Uint8Array(SHADOW_MASK_BYTES);
  return {
    row: (slice: number, face: number, row: number) => held[maskBase(slice, face) + row],
    /** The extent restarts, or the slice is reset: nothing holds it anymore. */
    clearFace(slice: number, face: number) {
      held.fill(0, maskBase(slice, face), maskBase(slice, face) + FACE_BYTES);
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
      for (let row = 0; row < FACE_BYTES; row++) held[base + row] &= ~strip[row];
    },
    /** A physical rectangle was drawn. */
    setRect(slice: number, face: number, x0: number, x1: number, y0: number, y1: number) {
      setRect(held, maskBase(slice, face), x0, x1, y0, y1, true);
    },
    /** The frame is about to admit regions: what they hold now is what a refusal restores. */
    snapshot() {
      admitted.set(held);
    },
    /** The rectangle's draw was refused: its pages hold what they held before admission. */
    restoreRect(slice: number, face: number, x0: number, x1: number, y0: number, y1: number) {
      const base = maskBase(slice, face);
      const span = (((1 << (x1 - x0 + 1)) - 1) << x0) & 0xff;
      for (let row = y0; row <= y1; row++)
        held[base + row] = (held[base + row] & ~span) | (admitted[base + row] & span);
    },
  };
}
