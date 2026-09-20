import {
  MAX_SHADOW_SLICES,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  LIGHT_FIELD,
  faceCountOf,
  pageRowsOf,
} from '../sdk-core/index.ts';
import type { WebgpuLightState } from './webgpuPagesStateLights.ts';

/** Slices already queued for this frame's push: set once, cleared after each frame. */
const queued = new Uint8Array(MAX_SHADOW_SLICES);

/** Word of four rows of drawn pages: the complement of the stale rows, eight bits each. */
function drawnWord(
  dirty: WebgpuLightState['plan']['slices']['dirty'],
  slice: number,
  face: number,
  first: number,
  rows: number,
) {
  let word = 0;
  for (let row = first; row < first + 4; row++) {
    // A row past the face's own is never read: it is left "drawn" so the mask is never a hole.
    const stale = row < rows ? dirty.row(slice, face, row) : 0;
    word |= (~stale & 0xff) << ((row - first) * 8);
  }
  return word >>> 0;
}

/**
 * Drawn-page masks of every shadowed light's faces, into the slice mirror, after the frame's
 * scheduling. A face whose mask changed joins `flushed` even when nothing was drawn in it:
 * a window that slid has a stale strip the read must fall through, and only the slice buffer
 * can tell it so. Returns the new count of slices to push.
 */
export function writeDrawnMasks(lights: WebgpuLightState, flushed: Int32Array, count: number) {
  const { store, plan, shadows } = lights,
    { slices } = plan,
    { packed } = store;
  if (!shadows) return count;
  for (let i = 0; i < count; i++) queued[flushed[i]] = 1;
  for (let slot = 0; slot < store.count; slot++) {
    const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
    const slice = store.sliceOf(slot);
    if (slice < 0 || packed[base + LIGHT_FIELD.castsShadow] === 0) continue;
    const faces = faceCountOf(packed[base + LIGHT_FIELD.kind]),
      rows = pageRowsOf(slices.side[slice]);
    let changed = false;
    for (let face = 0; face < faces; face++) {
      const low = drawnWord(slices.dirty, slice, face, 0, rows),
        high = drawnWord(slices.dirty, slice, face, 4, rows);
      if (shadows.writeDrawnMask(slice, face, low, high)) changed = true;
    }
    if (changed && !queued[slice]) {
      queued[slice] = 1;
      flushed[count++] = slice;
    }
  }
  for (let i = 0; i < count; i++) queued[flushed[i]] = 0;
  return count;
}
