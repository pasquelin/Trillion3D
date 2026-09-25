// What a sun's receivers read, for the per-frame proofs of #489: the pages of a few clipmap levels
// around a point of the ground, and the pages a world box covers — counted from the page's world
// square, `[ax, ax+1) · S` along the sun's right axis and `[ay, ay+1) · S` down its up axis.
import type { ShadowPlan } from './plan.ts';
import { PAGE_INDEX_MASK, PAGE_MAPPED, PAGE_VALID, sunEntry, sunPageMetres } from './virtual.ts';

/** A sun page: its level and its absolute page. */
export type SunPage = { level: number; ax: number; ay: number };

/** The sun's right and up axes, as the plan's clipmap holds them. */
const axes = (plan: ShadowPlan, slice: number) => {
  const f = plan.sun.frame.subarray(slice * 9, slice * 9 + 6);
  return {
    u: (p: ArrayLike<number>) => f[0] * p[0] + f[1] * p[1] + f[2] * p[2],
    v: (p: ArrayLike<number>) => -(f[3] * p[0] + f[4] * p[1] + f[5] * p[2]),
  };
};

/** The `side × side` pages of each of `levels` above the finest, centred on `at`. */
export function sunBlock(
  plan: ShadowPlan,
  slice: number,
  levels: number[],
  at: ArrayLike<number>,
  side: number,
) {
  const { u, v } = axes(plan, slice),
    pages: SunPage[] = [];
  for (const step of levels) {
    const level = plan.sun.finest[slice] + step,
      size = sunPageMetres(level);
    const x0 = Math.floor(u(at) / size) - side / 2,
      y0 = Math.floor(v(at) / size) - side / 2;
    for (let y = y0; y < y0 + side; y++)
      for (let x = x0; x < x0 + side; x++) pages.push({ level, ax: x, ay: y });
  }
  return pages;
}

/** Table entries of `pages`, for the report. */
export const entriesOf = (plan: ShadowPlan, slice: number, pages: SunPage[]) =>
  pages.map(({ level, ax, ay }) => plan.table.baseOf(slice) + sunEntry(level, ax, ay));

/** True when `page`'s world square meets the box `min..max` seen from the sun. */
export function covers(
  plan: ShadowPlan,
  slice: number,
  { level, ax, ay }: SunPage,
  min: number[],
  max: number[],
) {
  const { u, v } = axes(plan, slice),
    size = sunPageMetres(level);
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity;
  for (let corner = 0; corner < 8; corner++) {
    const p = [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? max[axis] : min[axis]));
    u0 = Math.min(u0, u(p));
    u1 = Math.max(u1, u(p));
    v0 = Math.min(v0, v(p));
    v1 = Math.max(v1, v(p));
  }
  return u1 >= ax * size && u0 <= (ax + 1) * size && v1 >= ay * size && v0 <= (ay + 1) * size;
}

/**
 * The physical page `page` is read from when it is current — mapped to that very level and
 * absolute page, drawn, and stale for nothing —, else −1: the content the converged pose holds.
 */
export function currentPage(plan: ShadowPlan, slice: number, page: SunPage) {
  const word = plan.table.words[entriesOf(plan, slice, [page])[0]];
  if (!(word & PAGE_MAPPED) || !(word & PAGE_VALID)) return -1;
  const { pool } = plan,
    phys = word & PAGE_INDEX_MASK;
  const same = pool.view[phys] === page.level && pool.x[phys] === page.ax;
  return same && pool.y[phys] === page.ay && !pool.dirty[phys] ? phys : -1;
}
