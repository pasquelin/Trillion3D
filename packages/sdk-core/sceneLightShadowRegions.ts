import type { ShadowDirty } from './sceneLightShadowDirty.ts';

/** Fields of a region: light, slice, face, then its page rectangle, bounds included. */
const FIELDS = 7;

/**
 * Regions of the frame: rectangles of contiguous pages to redraw, one indirect call each.
 *
 * Identical page rows group together — a fully stale face therefore yields **one**
 * region and a single call, exactly as before this batch. A partially stale row yields the
 * smallest rectangle that covers it: a clean page redrawn on the way keeps the same
 * depth, since it is the whole scene that is redrawn in the scissor.
 */
export function createShadowRegions(capacity: number) {
  const data = new Int32Array(capacity * FIELDS);
  let count = 0,
    pages = 0;
  const field = (region: number, index: number) => data[region * FIELDS + index];
  return {
    capacity,
    get count() {
      return count;
    },
    /** Pages the kept regions cover: the unit in which the budget counts the work. */
    get pages() {
      return pages;
    },
    lightOf: (region: number) => field(region, 0),
    sliceOf: (region: number) => field(region, 1),
    faceOf: (region: number) => field(region, 2),
    x0Of: (region: number) => field(region, 3),
    x1Of: (region: number) => field(region, 4),
    y0Of: (region: number) => field(region, 5),
    y1Of: (region: number) => field(region, 6),
    reset() {
      count = 0;
      pages = 0;
    },
    /**
     * Cuts the face into page rectangles and keeps them as long as `admit` accepts them. Each
     * kept region is immediately cleared from the mask: it is drawn by the current frame.
     * Returns false as soon as `admit` refuses a region — the rest of the face waits for the next frame.
     */
    addFace(
      dirty: ShadowDirty,
      light: number,
      slice: number,
      face: number,
      rows: number,
      admit: (pages: number) => boolean,
    ) {
      let row = 0;
      while (row < rows) {
        const bits = dirty.row(slice, face, row);
        if (!bits) {
          row++;
          continue;
        }
        let last = row;
        while (last + 1 < rows && dirty.row(slice, face, last + 1) === bits) last++;
        let x0 = 0,
          x1 = rows - 1;
        while (!((bits >> x0) & 1)) x0++;
        while (!((bits >> x1) & 1)) x1--;
        const area = (x1 - x0 + 1) * (last - row + 1);
        if (count >= capacity || !admit(area)) return false;
        const base = count * FIELDS;
        data[base] = light;
        data[base + 1] = slice;
        data[base + 2] = face;
        data[base + 3] = x0;
        data[base + 4] = x1;
        data[base + 5] = row;
        data[base + 6] = last;
        count++;
        pages += area;
        dirty.drew(slice, face, x0, x1, row, last);
        row = last + 1;
      }
      return true;
    },
  };
}

export type ShadowRegions = ReturnType<typeof createShadowRegions>;
