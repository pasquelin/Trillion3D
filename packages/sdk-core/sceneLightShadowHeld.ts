import { MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';
import { SHADOW_MASK_BYTES, markExtentRect, maskBase, setRect } from './sceneLightShadowPages.ts';

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
  return {
    row: (slice: number, face: number, row: number) => held[maskBase(slice, face) + row],
    /** The extent restarts, or the slice is reset: nothing holds it anymore. */
    clearFace(slice: number, face: number) {
      held.fill(0, maskBase(slice, face), maskBase(slice, face) + FACE_BYTES);
    },
    /** The extent rectangle that just entered: its physical pages hold the far side's depth. */
    clearExtentRect(
      slice: number,
      face: number,
      rows: number,
      wx: number,
      wy: number,
      x0: number,
      x1: number,
      y0: number,
      y1: number,
    ) {
      strip.fill(0);
      markExtentRect(strip, 0, rows, wx, wy, x0, x1, y0, y1);
      const base = maskBase(slice, face);
      for (let row = 0; row < FACE_BYTES; row++) held[base + row] &= ~strip[row];
    },
    /** A physical rectangle was drawn — or, `on` false, its draw was refused after all. */
    setRect(
      slice: number,
      face: number,
      x0: number,
      x1: number,
      y0: number,
      y1: number,
      on: boolean,
    ) {
      setRect(held, maskBase(slice, face), x0, x1, y0, y1, on);
    },
  };
}
