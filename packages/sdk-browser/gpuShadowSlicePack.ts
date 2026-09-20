import {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  POINT_FACES,
  RECTS_PER_SLICE,
  SHADOW_FACE_FLOATS,
  SHADOW_FACE_MASK_WORD,
  SHADOW_SLICE_FLOATS,
} from '../sdk-core/index.ts';

/**
 * Regions at most in a frame: the buffer cap, not a quality setting. A wholly stale face fits
 * in a single region, so this cap is at least what the old four-light cap allowed; the
 * millisecond budget almost always stops first.
 */
export const MAX_SHADOW_REGIONS = LIGHT_SETTINGS.shadowUpdatesPerFrame * POINT_FACES;
/**
 * Fourth float of a drawn face's rectangle: `1 + wx + 16·wy`, the physical page of the
 * window origin, so the read wraps window coordinates onto the face. Zero says "never
 * drawn"; a point or spot face, whose window never slides, carries one.
 */
export const WRAP_BASE = 16;
export const wrapKey = (wx: number, wy: number) => 1 + wx + WRAP_BASE * wy;

/**
 * Host mirrors of the two shadow buffers — the frame's region matrices, read by dynamic
 * offset, and the slices deferred resolve rereads — and the only writes into them.
 */
export function createShadowSlicePack(size: number, faceStride: number) {
  const slicePacked = new Float32Array(MAX_SHADOW_SLICES * SHADOW_SLICE_FLOATS);
  const sliceWords = new Uint32Array(slicePacked.buffer);
  const facePacked = new Float32Array((MAX_SHADOW_REGIONS * faceStride) / 4);
  return {
    slicePacked,
    facePacked,
    /**
     * Drawn-page mask of a face, two words of eight rows: the complement of the scheduler's
     * stale mask, in physical pages. Returns true when the words changed, so the slice is
     * pushed even on a frame that drew nothing in it — a slide alone stales a strip.
     */
    writeDrawnMask(slice: number, face: number, low: number, high: number) {
      const at = slice * SHADOW_SLICE_FLOATS + face * SHADOW_FACE_FLOATS + SHADOW_FACE_MASK_WORD;
      if (sliceWords[at] === low && sliceWords[at + 1] === high) return false;
      sliceWords[at] = low;
      sliceWords[at + 1] = high;
      return true;
    },
    /**
     * Writes a region into both buffers. The matrix is that of the whole window, never of the
     * region: that is what makes the page draw identical to the bit. `matrices` carries it at
     * `matrixBase`; nothing is copied into an intermediate array, and two regions of the same
     * face rewrite the same numbers there.
     *
     * `center` and `radius` tell the light envelope to the only buffer that reads it, the
     * draw one: the shadow shader writes no depth for a surface locked inside it. A light
     * without an envelope — a directional, or a light with no declared radius — carries a
     * zero radius, and the comparison then strips nothing.
     *
     * `shiftX`/`shiftY` translate the draw matrix alone, in clip units: whole pages, so the
     * region's window pages land on their physical pages. The slice keeps the window matrix
     * and `wrap`, the key the read unwraps it with.
     */
    writeRegion(
      index: number,
      slice: number,
      face: number,
      matrices: Float32Array,
      matrixBase: number,
      rects: Int32Array,
      center: readonly number[] | undefined,
      radius: number,
      shiftX = 0,
      shiftY = 0,
      wrap = 1,
    ) {
      const rect = slice * RECTS_PER_SLICE + face * 3,
        x = rects[rect] / size,
        y = rects[rect + 1] / size,
        side = rects[rect + 2];
      const uniform = (index * faceStride) / 4,
        entry = slice * SHADOW_SLICE_FLOATS + face * SHADOW_FACE_FLOATS;
      for (let i = 0; i < 16; i++) {
        facePacked[uniform + i] = matrices[matrixBase + i];
        slicePacked[entry + i] = matrices[matrixBase + i];
      }
      facePacked[uniform + 12] += shiftX;
      facePacked[uniform + 13] += shiftY;
      const span = side / size;
      facePacked[uniform + 16] = x;
      facePacked[uniform + 17] = y;
      facePacked[uniform + 18] = span;
      facePacked[uniform + 19] = side;
      slicePacked[entry + 16] = x;
      slicePacked[entry + 17] = y;
      slicePacked[entry + 18] = span;
      slicePacked[entry + 19] = side > 0 ? wrap : 0;
      facePacked[uniform + 20] = center ? center[0] : 0;
      facePacked[uniform + 21] = center ? center[1] : 0;
      facePacked[uniform + 22] = center ? center[2] : 0;
      facePacked[uniform + 23] = center ? radius : 0;
      return side;
    },
    /** Slice header: faces, tangent half-angle, side in texels, near plane. */
    writeSliceInfo(slice: number, faces: number, tanHalfFov: number, side: number, near: number) {
      const base = slice * SHADOW_SLICE_FLOATS + POINT_FACES * SHADOW_FACE_FLOATS;
      slicePacked[base] = faces;
      slicePacked[base + 1] = tanHalfFov;
      slicePacked[base + 2] = side;
      slicePacked[base + 3] = near;
    },
  };
}
