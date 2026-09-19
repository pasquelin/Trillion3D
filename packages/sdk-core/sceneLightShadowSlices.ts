import { MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';
import { createShadowAtlas } from './sceneLightShadowAtlas.ts';
import { createShadowDirty } from './sceneLightShadowDirty.ts';

/** Rectangles of a slice: `(x, y, side)` per face, six faces reserved for every slice. */
export const RECTS_PER_SLICE = POINT_FACES * 3;
/** Key of a cascade: centre aligned on the texel grid and radius. Four numbers, not one more. */
const CASCADE_KEY = 4;

/**
 * The shadow-slice table: which slice is taken, at which side, which pages of which face
 * await their draw, and — for a sun cascade — the world extent its map describes.
 *
 * A map is no longer "up to date or stale": it carries waiting pages. A moving light
 * stales them all; a moving object only stales a few. Everything is allocated once;
 * a slice is only reallocated when the face count changes or the wanted side doubles or
 * halves.
 */
export function createShadowSliceTable() {
  const atlas = createShadowAtlas();
  const dirty = createShadowDirty();
  const rects = new Int32Array(MAX_SHADOW_SLICES * RECTS_PER_SLICE);
  /** A taken slice, without saying by whom: the store already carries the light → slice link. */
  const taken = new Uint8Array(MAX_SHADOW_SLICES);
  const faces = new Int32Array(MAX_SHADOW_SLICES),
    side = new Int32Array(MAX_SHADOW_SLICES),
    revision = new Uint32Array(MAX_SHADOW_SLICES),
    noted = new Uint8Array(MAX_SHADOW_SLICES),
    drawn = new Uint8Array(MAX_SHADOW_SLICES),
    /** World extent of each cascade at the last draw: the sun follows the camera, not the light. */
    cascade = new Float64Array(MAX_SHADOW_SLICES * POINT_FACES * CASCADE_KEY),
    cascadeSeen = new Uint8Array(MAX_SHADOW_SLICES * POINT_FACES);
  const table = {
    atlas,
    dirty,
    rects,
    /** Taken slices, so release knows which ones no light claims anymore. */
    taken,
    faces,
    side,
    revision,
    noted,
    drawn,
    free(slice: number) {
      if (slice < 0) return;
      atlas.release(faces[slice], rects, slice * RECTS_PER_SLICE);
      dirty.reset(slice);
      taken[slice] = 0;
      faces[slice] = 0;
      side[slice] = 0;
      noted[slice] = 0;
      drawn[slice] = 0;
      for (let face = 0; face < POINT_FACES; face++) cascadeSeen[slice * POINT_FACES + face] = 0;
    },
    /** The first free slice, or −1 when the 64 published slices are taken. */
    claim() {
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++)
        if (!taken[slice]) {
          taken[slice] = 1;
          revision[slice] = 0;
          noted[slice] = 0;
          drawn[slice] = 0;
          dirty.reset(slice);
          return slice;
        }
      return -1;
    },
    /**
     * Ensures the slice carries `wantedFaces` faces at side `wantedSide`. Returns the side obtained, or 0
     * if the atlas cannot place it: the slice is then released and the light stays without a shadow.
     * A reallocation gives new texels, so every page goes back to waiting.
     */
    fit(slice: number, wantedFaces: number, wantedSide: number) {
      const keep =
        faces[slice] === wantedFaces &&
        side[slice] > 0 &&
        wantedSide < side[slice] * 2 &&
        wantedSide * 2 > side[slice];
      if (keep) return side[slice];
      atlas.release(faces[slice], rects, slice * RECTS_PER_SLICE);
      const got = atlas.allocate(wantedFaces, wantedSide, rects, slice * RECTS_PER_SLICE);
      faces[slice] = got ? wantedFaces : 0;
      side[slice] = got;
      noted[slice] = 0;
      drawn[slice] = 0;
      dirty.reset(slice);
      if (!got) taken[slice] = 0;
      return got;
    },
    /**
     * Invalidation of this light revision is **recorded**: it is the pages that now
     * carry the remaining work. Without this mark, a moved light would see its whole face
     * put back to waiting every frame and would never progress.
     */
    noteRevision(slice: number, lightRevision: number) {
      revision[slice] = lightRevision;
      noted[slice] = 1;
    },
    /** A region of the slice has been drawn: it is no longer a virgin slice. */
    markDrawn(slice: number) {
      drawn[slice] = 1;
    },
    /**
     * Has a cascade's world extent changed since its last draw? A cascade follows the
     * camera: as long as its aligned centre and radius are the same, its map describes exactly the
     * same thing and is kept. As soon as they change, the map describes another world extent and
     * none of its texels is worth anything — the atlas does not address its pages in a ring, so there
     * is nothing to recover from a slide, and the cascade redraws in full.
     */
    cascadeChanged(slice: number, face: number, center: ArrayLike<number>, radius: number) {
      const index = slice * POINT_FACES + face,
        base = index * CASCADE_KEY;
      const same =
        cascadeSeen[index] === 1 &&
        cascade[base] === center[0] &&
        cascade[base + 1] === center[1] &&
        cascade[base + 2] === center[2] &&
        cascade[base + 3] === radius;
      if (same) return false;
      cascadeSeen[index] = 1;
      cascade[base] = center[0];
      cascade[base + 1] = center[1];
      cascade[base + 2] = center[2];
      cascade[base + 3] = radius;
      return true;
    },
    reset() {
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++) table.free(slice);
    },
  };
  return table;
}
