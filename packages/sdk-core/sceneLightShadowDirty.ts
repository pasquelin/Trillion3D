import { MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';
import {
  SHADOW_MASK_BYTES,
  countPages,
  clearFace,
  faceDirty,
  markBoxPages,
  markWholeFace,
  maskBase,
  setRect,
} from './sceneLightShadowPages.ts';

const FACES = MAX_SHADOW_SLICES * POINT_FACES;

/**
 * Stale pages of each face, and since when.
 *
 * The state of a shadow map is no longer "up to date or not" but "which pages are to remake": a
 * moving light stales its whole map, a moving object only stales the pages its projected
 * box covers. The moment a clean face became dirty again is kept as-is: it is what
 * gives the published lag, and it only restarts once the last page of the face is redrawn.
 *
 * Everything is allocated once: 64 slices × 6 faces × 8 mask bytes.
 */
export function createShadowDirty() {
  const mask = new Uint8Array(SHADOW_MASK_BYTES);
  const since = new Float64Array(FACES),
    sinceFrame = new Float64Array(FACES),
    dirty = new Uint8Array(FACES);
  /** Pages that entered the queue since the start of the frame: a raw count, never a difference. */
  let added = 0;
  const indexOf = (slice: number, face: number) => slice * POINT_FACES + face;
  /** The face has been waiting since now, if it was not already: lag never restarts. */
  const waitFrom = (slice: number, face: number, nowMs: number, frame: number) => {
    const index = indexOf(slice, face);
    if (dirty[index]) return;
    dirty[index] = 1;
    since[index] = nowMs;
    sinceFrame[index] = frame;
  };
  /** The face no longer waits: its timestamp restarts from zero with it. */
  const forget = (index: number) => {
    dirty[index] = 0;
    since[index] = 0;
    sinceFrame[index] = 0;
  };
  /** Pages have just entered the queue: they are counted, and the face starts waiting. */
  const entered = (
    slice: number,
    face: number,
    base: number,
    before: number,
    nowMs: number,
    frame: number,
  ) => {
    added += countPages(mask, base) - before;
    waitFrom(slice, face, nowMs, frame);
  };
  return {
    /** Pages that actually entered the queue since the last `beginFrame`. */
    get invalidated() {
      return added;
    },
    beginFrame() {
      added = 0;
    },
    /** True if the face carries at least one waiting page. */
    isDirty: (slice: number, face: number) => dirty[indexOf(slice, face)] === 1,
    /** Lag of the oldest page of the face, in milliseconds and in frames. */
    waitedMs: (slice: number, face: number, nowMs: number) => {
      const index = indexOf(slice, face);
      return dirty[index] ? nowMs - since[index] : 0;
    },
    waitedFrames: (slice: number, face: number, frame: number) => {
      const index = indexOf(slice, face);
      return dirty[index] ? frame - sinceFrame[index] : 0;
    },
    pages: (slice: number, face: number) => countPages(mask, maskBase(slice, face)),
    row: (slice: number, face: number, row: number) => mask[maskBase(slice, face) + row],
    /** The whole face is to remake: moved light, reallocated slice, moved cascade, first frame. */
    whole(slice: number, face: number, rows: number, nowMs: number, frame: number) {
      const base = maskBase(slice, face);
      const before = countPages(mask, base);
      markWholeFace(mask, base, rows);
      entered(slice, face, base, before, nowMs, frame);
    },
    /** The pages the world box covers in this face, and those alone. */
    box(
      slice: number,
      face: number,
      rows: number,
      matrix: Float32Array,
      matrixBase: number,
      min: ArrayLike<number>,
      max: ArrayLike<number>,
      nowMs: number,
      frame: number,
    ) {
      const base = maskBase(slice, face);
      const before = countPages(mask, base);
      if (!markBoxPages(mask, base, rows, matrix, matrixBase, min, max)) return false;
      entered(slice, face, base, before, nowMs, frame);
      return true;
    },
    /** A region has just been redrawn: its pages are no longer waiting. */
    drew(slice: number, face: number, x0: number, x1: number, y0: number, y1: number) {
      const base = maskBase(slice, face);
      setRect(mask, base, x0, x1, y0, y1, false);
      if (!faceDirty(mask, base)) forget(indexOf(slice, face));
    },
    /**
     * The region was not drawn after all — the pass could not be encoded —: its pages
     * return to the queue. Without that, a map would keep a stale depth without anything
     * saying so.
     */
    undrew(
      slice: number,
      face: number,
      x0: number,
      x1: number,
      y0: number,
      y1: number,
      nowMs: number,
      frame: number,
    ) {
      setRect(mask, maskBase(slice, face), x0, x1, y0, y1, true);
      // These pages had already been counted at their queue entry: they come back, without
      // going through `added` again, which counts entries and not round-trips.
      waitFrom(slice, face, nowMs, frame);
    },
    /** The slice is released or retaken: no page waits for it anymore. */
    reset(slice: number) {
      for (let face = 0; face < POINT_FACES; face++) {
        clearFace(mask, maskBase(slice, face));
        forget(indexOf(slice, face));
      }
    },
  };
}

export type ShadowDirty = ReturnType<typeof createShadowDirty>;
