import { rowSpan } from './pages.ts';

/**
 * THE PAGES A LIGHT CUT DRAWS INTO, and the test that keeps a box only if it can reach one.
 *
 * A shadow face is a square of `rows × rows` pages, at most eight by eight, so the pages a frame
 * redraws in it fit two words: row `r` is the byte `r & 3` of word `r >> 2`, column `c` its
 * bit `c`. That is the layout of the scheduler's own page masks (`pages.ts`), read here in
 * extent coordinates — the frame the region rectangles are written in.
 *
 * A cascade sliding diagonally redraws an L-shaped strip: the rectangle that bounds it is the
 * whole face, and a cut bounded by planes alone would select the face entire. The box is
 * projected on the face instead, and dropped when none of the pages its rectangle covers is
 * redrawn this frame: what it would write there would be clipped anyway.
 */
export interface LightPages {
  /** Pages per side of the face. */
  rows: number;
  /** Redrawn pages, two words of four row bytes. */
  mask: Uint32Array;
  /** First term of the face projection: clip x and y per unit of view length, at unit depth. */
  clipScale: number;
  /** One texel, in clip units: the margin that keeps a box grazing a page from rounding off it. */
  clipPad: number;
}

export const createLightPages = (): LightPages => ({
  rows: 1,
  mask: new Uint32Array(2),
  clipScale: 1,
  clipPad: 0,
});

/** Marks pages `[x0, x1] × [y0, y1]` of the mask, bounds included and clamped to the face. */
export function markLightPages(pages: LightPages, x0: number, x1: number, y0: number, y1: number) {
  const last = pages.rows - 1;
  const from = Math.max(0, x0),
    to = Math.min(last, x1);
  if (from > to) return;
  const span = rowSpan(from, to);
  for (let row = Math.max(0, y0); row <= Math.min(last, y1); row++)
    pages.mask[row >> 2] |= span << ((row & 3) * 8);
}

/** Row `row`'s byte of the mask. */
const rowBits = (mask: ArrayLike<number>, row: number) =>
  (mask[row >> 2] >>> ((row & 3) * 8)) & 0xff;

/**
 * True when the box — local bounds under the column-major `view · world` matrix `e` — covers no
 * marked page. Conservative: the box's view-space bounds are those of its centre and its
 * extents carried by the absolute linear part, and under a perspective projection its clip
 * rectangle is widened to both depth bounds; a box that reaches behind the light keeps
 * everything. GPU mirror: `pageMissed` in `packages/sdk-browser/src/gpu/dag/shader/pagesWgsl.ts`.
 */
export function boxMissesLightPages(
  pages: LightPages,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  e: ArrayLike<number>,
  perspective: number,
) {
  const cx = (min[0] + max[0]) / 2,
    cy = (min[1] + max[1]) / 2,
    cz = (min[2] + max[2]) / 2;
  const hx = (max[0] - min[0]) / 2,
    hy = (max[1] - min[1]) / 2,
    hz = (max[2] - min[2]) / 2;
  const vx = e[0] * cx + e[4] * cy + e[8] * cz + e[12],
    vy = e[1] * cx + e[5] * cy + e[9] * cz + e[13],
    vz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
  const ex = Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz,
    ey = Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz,
    ez = Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz;
  const flat = 1 - perspective;
  const near = perspective * (-vz - ez) + flat,
    far = perspective * (-vz + ez) + flat;
  if (!(near > 0)) return false;
  const s = pages.clipScale,
    pad = pages.clipPad;
  const u0 = Math.min(((vx - ex) * s) / near, ((vx - ex) * s) / far) - pad,
    u1 = Math.max(((vx + ex) * s) / near, ((vx + ex) * s) / far) + pad,
    v0 = Math.min(((vy - ey) * s) / near, ((vy - ey) * s) / far) - pad,
    v1 = Math.max(((vy + ey) * s) / near, ((vy + ey) * s) / far) + pad;
  const half = pages.rows / 2,
    last = pages.rows - 1;
  // Columns grow with u, rows grow downward: the top of the face is row zero.
  const c0 = Math.max(0, Math.floor((u0 + 1) * half)),
    c1 = Math.min(last, Math.floor((u1 + 1) * half)),
    r0 = Math.max(0, Math.floor((1 - v1) * half)),
    r1 = Math.min(last, Math.floor((1 - v0) * half));
  if (!(c0 <= c1 && r0 <= r1)) return true;
  const span = rowSpan(c0, c1);
  for (let row = r0; row <= r1; row++) if (rowBits(pages.mask, row) & span) return false;
  return true;
}
