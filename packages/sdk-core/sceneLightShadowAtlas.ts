import { LIGHT_SETTINGS, POINT_FACES } from './sceneLightContracts.ts';

/** Side of a base atlas cell: the smallest slice the contract publishes. */
const CELL = LIGHT_SETTINGS.shadowSliceMin;
/** Base cells per atlas side. 4096 / 128 = 32, i.e. 1024 cells. */
const GRID = Math.floor(LIGHT_SETTINGS.shadowAtlasSize / CELL);
/** Face sides the atlas knows how to place, from largest to smallest. */
export const SHADOW_FACE_SIDES: readonly number[] = (() => {
  const sides: number[] = [];
  for (let side: number = LIGHT_SETTINGS.shadowSliceMax; side >= CELL; side = Math.floor(side / 2))
    sides.push(side);
  return sides;
})();

/**
 * Placement of faces in the depth atlas. Each face occupies an aligned square block of
 * `k × k` base cells; a point reserves six, a spot one. Placement only
 * changes when a light acquires or releases its slice, never per frame, and occupancy is
 * a single byte array allocated once.
 */
export function createShadowAtlas() {
  const used = new Uint8Array(GRID * GRID);
  const free = (cx: number, cy: number, k: number) => {
    if (cx + k > GRID || cy + k > GRID) return false;
    for (let y = cy; y < cy + k; y++)
      for (let x = cx; x < cx + k; x++) if (used[y * GRID + x]) return false;
    return true;
  };
  const mark = (cx: number, cy: number, k: number, value: number) => {
    for (let y = cy; y < cy + k; y++) for (let x = cx; x < cx + k; x++) used[y * GRID + x] = value;
  };
  /** A block aligned on its own size: the search stays a scan bounded by the grid. */
  const claim = (k: number) => {
    for (let cy = 0; cy + k <= GRID; cy += k)
      for (let cx = 0; cx + k <= GRID; cx += k)
        if (free(cx, cy, k)) {
          mark(cx, cy, k, 1);
          return [cx, cy] as const;
        }
    return undefined;
  };
  return {
    size: LIGHT_SETTINGS.shadowAtlasSize,
    cell: CELL,
    grid: GRID,
    /** Occupied cells over the total: what the diagnostic publishes as atlas load. */
    occupancy() {
      let count = 0;
      for (let i = 0; i < used.length; i++) count += used[i];
      return { used: count, total: used.length };
    },
    /**
     * Reserves `faces` blocks of side `side` texels and writes their rectangles `(x, y, side)` into
     * `rects`. Returns the side actually obtained, or 0 if the atlas is full even at the minimum side:
     * the light then stays without a shadow, which the diagnostic declares.
     */
    allocate(faces: number, side: number, rects: Int32Array, base: number) {
      for (const candidate of SHADOW_FACE_SIDES) {
        if (candidate > side) continue;
        const k = candidate / CELL;
        let placed = 0;
        for (; placed < faces; placed++) {
          const spot = claim(k);
          if (!spot) break;
          rects[base + placed * 3] = spot[0] * CELL;
          rects[base + placed * 3 + 1] = spot[1] * CELL;
          rects[base + placed * 3 + 2] = candidate;
        }
        if (placed === faces) return candidate;
        for (let i = 0; i < placed; i++)
          mark(rects[base + i * 3] / CELL, rects[base + i * 3 + 1] / CELL, k, 0);
      }
      for (let i = 0; i < faces * 3; i++) rects[base + i] = 0;
      return 0;
    },
    release(faces: number, rects: Int32Array, base: number) {
      for (let i = 0; i < faces; i++) {
        const side = rects[base + i * 3 + 2];
        if (side <= 0) continue;
        mark(rects[base + i * 3] / CELL, rects[base + i * 3 + 1] / CELL, side / CELL, 0);
        rects[base + i * 3] = 0;
        rects[base + i * 3 + 1] = 0;
        rects[base + i * 3 + 2] = 0;
      }
    },
  };
}

/**
 * Face side a light deserves: its range projected on screen, capped by its share of
 * the atlas. A light that covers the whole screen and is alone takes `shadowSliceMax`; at thirty
 * shadow lights, each steps down by itself rather than leaving the last ones without a slice.
 * The floor is `shadowSliceMin`: no light disappears for lack of room as long as some remains.
 */
export function desiredFaceSide(screenCoverage: number, faces: number, casters = 1) {
  // A point pays six faces: it therefore asks for one side less than a spot.
  const wanted =
    (Math.sqrt(Math.max(0, Math.min(1, screenCoverage))) * LIGHT_SETTINGS.shadowSliceMax) /
    (faces === POINT_FACES ? 2 : 1);
  // Atlas share of a light: `GRID²` cells shared among requesters, `faces` per light.
  const share = Math.sqrt((GRID * GRID) / Math.max(1, casters * faces)) * CELL;
  const budget = Math.max(LIGHT_SETTINGS.shadowSliceMin, Math.min(wanted, share));
  let chosen: number = LIGHT_SETTINGS.shadowSliceMin;
  for (const side of SHADOW_FACE_SIDES)
    if (side <= budget) {
      chosen = side;
      break;
    }
  return chosen;
}
