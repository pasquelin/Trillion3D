import { MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';
import { createShadowAtlas } from './sceneLightShadowAtlas.ts';
import { createShadowDirty } from './sceneLightShadowDirty.ts';

/** Rectangles of a slice: `(x, y, side)` per face, six faces reserved for every slice. */
export const RECTS_PER_SLICE = POINT_FACES * 3;
/** Key of a cascade window: page origin, depth anchor and radius. Four numbers, not one more. */
const CASCADE_KEY = 4;
/** Verdicts of `cascadeSlide`: the map is kept, slides by whole pages, or restarts whole. */
const CASCADE_SAME = 0;
export const CASCADE_SLIDE = 1,
  CASCADE_WHOLE = 2;
/** What a cascade window slid by, in pages, after a `CASCADE_SLIDE` verdict. */
export const cascadeShift = { x: 0, y: 0 };

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
     * Compares a cascade's window with the one its map describes, and records the new one.
     * A cascade follows the camera, but its map is addressed by absolute page: as long as
     * the origin, anchor and radius are the same, every texel is worth what it was; a move by
     * whole pages keeps the pages that stay inside and only the entering strip restarts
     * (`cascadeShift` says by how much); a move of a window side or more, a new anchor along
     * the axis or a new radius describe another world and the cascade redraws in full.
     */
    cascadeSlide(
      slice: number,
      face: number,
      rows: number,
      originX: number,
      originY: number,
      anchor: number,
      radius: number,
    ) {
      const index = slice * POINT_FACES + face,
        base = index * CASCADE_KEY;
      const seen = cascadeSeen[index] === 1,
        dx = originX - cascade[base],
        dy = originY - cascade[base + 1],
        sameDepth = cascade[base + 2] === anchor && cascade[base + 3] === radius;
      cascadeSeen[index] = 1;
      cascade[base] = originX;
      cascade[base + 1] = originY;
      cascade[base + 2] = anchor;
      cascade[base + 3] = radius;
      if (!seen || !sameDepth || Math.abs(dx) >= rows || Math.abs(dy) >= rows) return CASCADE_WHOLE;
      if (dx === 0 && dy === 0) return CASCADE_SAME;
      cascadeShift.x = dx;
      cascadeShift.y = dy;
      return CASCADE_SLIDE;
    },
    reset() {
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++) table.free(slice);
    },
  };
  return table;
}
