import type { ShadowDirty } from './dirty.ts';

/** Fields of a region: light, slice, face, its physical page rectangle, bounds included, the
 *  page translation from extent to physical, `x` and `y`, then the two held words of the face
 *  before the draw — what a refused draw gives its pages back. */
const FIELDS = 11;

/**
 * Regions of the frame: rectangles of contiguous physical pages to redraw, one indirect call
 * each, with the whole-page translation the draw applies to the extent matrix so that each
 * extent page lands on its physical page.
 *
 * Identical page rows group together — a fully stale face therefore yields **one** region and
 * a single call, exactly as before this batch. A partially stale row yields the smallest
 * rectangle that covers it: a clean page redrawn on the way keeps the same depth, since it is
 * the whole scene that is redrawn in the scissor. A rectangle that straddles the seam of a
 * slid cascade — the physical column or row where the extent wraps — is cut there, since the
 * two sides carry two different translations.
 */
export function createShadowRegions(capacity: number) {
  const data = new Int32Array(capacity * FIELDS);
  let count = 0,
    pages = 0;
  const field = (region: number, index: number) => data[region * FIELDS + index];
  /** Last physical page before the seam, on one axis: a span starting at `p0` stops there. */
  const seamEnd = (wrap: number, p0: number, p1: number) =>
    p0 < wrap && wrap <= p1 ? wrap - 1 : p1;
  /** Translation from extent page to physical page of the span that starts at `p0`. */
  const shiftOf = (rows: number, wrap: number, p0: number) => (p0 < wrap ? wrap - rows : wrap);
  /** The face being cut, posted by `addFace`: `push` is one closure for every face and frame. */
  const cut = {
    dirty: undefined as unknown as ShadowDirty,
    admit: undefined as unknown as (pages: number) => boolean,
    light: 0,
    slice: 0,
    face: 0,
    rows: 0,
    wx: 0,
    wy: 0,
  };
  /** Keeps the rectangle, records what its pages held, and takes them out of the queue. */
  const push = (x0: number, x1: number, y0: number, y1: number) => {
    const { dirty, slice, face, rows } = cut;
    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (count >= capacity || !cut.admit(area)) return false;
    const base = count * FIELDS;
    data[base] = cut.light;
    data[base + 1] = slice;
    data[base + 2] = face;
    data[base + 3] = x0;
    data[base + 4] = x1;
    data[base + 5] = y0;
    data[base + 6] = y1;
    data[base + 7] = shiftOf(rows, cut.wx, x0);
    data[base + 8] = shiftOf(rows, cut.wy, y0);
    data[base + 9] = dirty.heldWord(slice, face, 0);
    data[base + 10] = dirty.heldWord(slice, face, 1);
    count++;
    pages += area;
    dirty.drew(slice, face, x0, x1, y0, y1);
    return true;
  };
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
    shiftXOf: (region: number) => field(region, 7),
    shiftYOf: (region: number) => field(region, 8),
    heldLowOf: (region: number) => field(region, 9) >>> 0,
    heldHighOf: (region: number) => field(region, 10) >>> 0,
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
      cut.dirty = dirty;
      cut.admit = admit;
      cut.light = light;
      cut.slice = slice;
      cut.face = face;
      cut.rows = rows;
      cut.wx = dirty.wrapXOf(slice, face);
      cut.wy = dirty.wrapYOf(slice, face);
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
        for (let y = row; y <= last;) {
          const yEnd = seamEnd(cut.wy, y, last);
          for (let x = x0; x <= x1;) {
            const xEnd = seamEnd(cut.wx, x, x1);
            if (!push(x, xEnd, y, yEnd)) return false;
            x = xEnd + 1;
          }
          y = yEnd + 1;
        }
        row = last + 1;
      }
      return true;
    },
  };
}

export type ShadowRegions = ReturnType<typeof createShadowRegions>;
