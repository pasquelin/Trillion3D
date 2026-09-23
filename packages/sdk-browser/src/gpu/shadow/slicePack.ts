import {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  POINT_FACES,
  RECTS_PER_SLICE,
  SHADOW_FACE_FLOATS,
  SHADOW_FACE_MASK_WORD,
  SHADOW_SLICE_FLOATS,
} from '../../../../sdk-core/src/index.ts';

/**
 * Regions at most in a frame: the buffer cap, not a quality setting. A wholly stale face fits
 * in a single region, so this cap is at least what the old four-light cap allowed; the
 * millisecond budget almost always stops first.
 */
export const MAX_SHADOW_REGIONS = LIGHT_SETTINGS.shadowUpdatesPerFrame * POINT_FACES;

/**
 * Host mirrors of the two shadow buffers — the frame's region matrices, read by dynamic
 * offset, and the slices deferred resolve rereads — and the only writes into them. A slice
 * written by either writer is flagged to push; `flushSlices` visits the flags once and drops
 * them.
 */
export function createShadowSlicePack(size: number, faceStride: number) {
  const slicePacked = new Float32Array(MAX_SHADOW_SLICES * SHADOW_SLICE_FLOATS);
  const sliceWords = new Uint32Array(slicePacked.buffer);
  const facePacked = new Float32Array((MAX_SHADOW_REGIONS * faceStride) / 4);
  const toPush = new Uint8Array(MAX_SHADOW_SLICES);
  return {
    slicePacked,
    facePacked,
    /**
     * Held-page mask of a face, two words of eight rows — the physical pages that hold a depth
     * of the face's extent (`sceneLightShadowHeld.ts`), not the complement of the stale mask —
     * and the physical page of the extent origin, `(wx, wy)`, the read wraps extent coordinates
     * with. A change flags the slice to push even on a frame that drew nothing in it: a slide
     * alone unholds a strip and moves the origin.
     */
    writeDrawnMask(slice: number, face: number, low: number, high: number, wx: number, wy: number) {
      const at = slice * SHADOW_SLICE_FLOATS + face * SHADOW_FACE_FLOATS + SHADOW_FACE_MASK_WORD;
      if (
        sliceWords[at] === low &&
        sliceWords[at + 1] === high &&
        sliceWords[at + 2] === wx &&
        sliceWords[at + 3] === wy
      )
        return;
      sliceWords[at] = low;
      sliceWords[at + 1] = high;
      sliceWords[at + 2] = wx;
      sliceWords[at + 3] = wy;
      toPush[slice] = 1;
    },
    /** Slices written since the last flush, each once; the flags drop as they are visited. */
    flushSlices(write: (slice: number) => void) {
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++) {
        if (!toPush[slice]) continue;
        toPush[slice] = 0;
        write(slice);
      }
    },
    /**
     * Writes a region into both buffers. The matrix is that of the whole extent, never of the
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
     * region's extent pages land on their physical pages. The slice keeps the extent matrix;
     * the fourth float of its rectangle says drawn (1) or never (0).
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
      slicePacked[entry + 19] = side > 0 ? 1 : 0;
      toPush[slice] = 1;
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
