// The two visbuffer fills that batch C compares; their frame loop is `rasterFrameLoop.ts`.
// `fillReference` is `fillIds` from `packages/sdk-browser/src/visibility/raster.ts` copied as-is, what the package does;
// `fillAffine` is the rejected candidate, one division per triangle and constant steps.
// Keeping them side by side is what makes the rejection reproducible.
import { depthNearer } from '../../../../packages/sdk-browser/src/camera/depthConvention.ts';
import type { Projected } from '../../../../packages/sdk-browser/src/visibility/projection.ts';

export type Keep = (x: number, y: number, w0: number, w1: number, w2: number) => boolean;

/** `packages/sdk-browser/src/visibility/raster.ts` (`fillIds`): one division per weight and per pixel, what the package does. */
export function fillReference(
  ids: Uint32Array,
  depth: Float32Array,
  width: number,
  height: number,
  a: Projected,
  b: Projected,
  c: Projected,
  packed: number,
  keep?: Keep,
) {
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (area === 0) return;
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))),
    maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))),
    maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  const ax = a.x,
    ay = a.y,
    az = a.z;
  const bx = b.x,
    by = b.y,
    bz = b.z;
  const cx = c.x,
    cy = c.y,
    cz = c.z;
  for (let y = minY; y <= maxY; y++) {
    const cy_y = cy - y,
      by_y = by - y,
      ay_y = ay - y;
    const row = y * width;
    for (let x = minX; x <= maxX; x++) {
      const bx_x = bx - x,
        cx_x = cx - x;
      const w0 = (bx_x * cy_y - cx_x * by_y) / area;
      if (w0 < 0) continue;
      const ax_x = ax - x;
      const w1 = (cx_x * ay_y - ax_x * cy_y) / area;
      if (w1 < 0) continue;
      const w2 = 1 - w0 - w1;
      if (w2 < 0) continue;
      if (keep && !keep(x, y, w0, w1, w2)) continue;
      const z = w0 * az + w1 * bz + w2 * cz,
        o = row + x;
      if (!depthNearer(z, depth[o])) continue;
      depth[o] = z;
      ids[o] = packed;
    }
  }
}

/** The rejected candidate: the weights are affine, a single division per triangle. */
export function fillAffine(
  ids: Uint32Array,
  depth: Float32Array,
  width: number,
  height: number,
  a: Projected,
  b: Projected,
  c: Projected,
  packed: number,
  keep?: Keep,
) {
  const ax = a.x,
    ay = a.y,
    az = a.z;
  const bx = b.x,
    by = b.y,
    bz = b.z;
  const cx = c.x,
    cy = c.y,
    cz = c.z;
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (area === 0) return;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
    maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))),
    maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  const invArea = 1 / area;
  const dx0 = (by - cy) * invArea,
    dy0 = (cx - bx) * invArea;
  const dx1 = (cy - ay) * invArea,
    dy1 = (ax - cx) * invArea;
  const base0 = (bx * cy - cx * by) * invArea,
    base1 = (cx * ay - ax * cy) * invArea;
  for (let y = minY; y <= maxY; y++) {
    const row = y * width;
    const row0 = base0 + y * dy0,
      row1 = base1 + y * dy1;
    for (let x = minX; x <= maxX; x++) {
      const w0 = row0 + x * dx0;
      if (w0 < 0) continue;
      const w1 = row1 + x * dx1;
      if (w1 < 0) continue;
      const w2 = 1 - w0 - w1;
      if (w2 < 0) continue;
      if (keep && !keep(x, y, w0, w1, w2)) continue;
      const z = w0 * az + w1 * bz + w2 * cz,
        o = row + x;
      if (!depthNearer(z, depth[o])) continue;
      depth[o] = z;
      ids[o] = packed;
    }
  }
}
