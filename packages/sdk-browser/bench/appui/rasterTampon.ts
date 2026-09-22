// The two visbuffer fills that batch C compares, and the frame loop that calls them.
// `fillReference` is `fillIds` from `visibilityRaster.ts` copied as-is, what the package does;
// `fillAffine` is the rejected candidate, one division per triangle and constant steps.
// Keeping them side by side is what makes the rejection reproducible.
import * as THREE from 'three';
import { DEPTH_CLEAR, depthNearer } from '../../depthConvention.ts';
import { perspectiveBary, triangleAt, wrapTexel } from '../../visibilityMath.ts';
import {
  assertVisibilityPageTriangles,
  packVisibilityId,
  textureRgba,
  VIS_MAX_PAGES,
  VIS_TRIANGLE_MASK,
} from '../../visibilityTypes.ts';
import type { Projected } from '../../visibilityProjection.ts';
import type { VisMaterial, VisPage } from '../../visibilityTypes.ts';

type Keep = (x: number, y: number, w0: number, w1: number, w2: number) => boolean;

/** `visibilityRaster.ts` (`fillIds`): one division per weight and per pixel, what the package does. */
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

type Triangle = NonNullable<ReturnType<typeof triangleAt>>;

/** The fill's alpha test, the same on both sides: it reads the weights it is given. */
function alphaGarde(
  page: VisPage,
  tri: Triangle,
  mat: VisMaterial,
  w0: number,
  w1: number,
  w2: number,
) {
  const uv = page.attributes.uv;
  const bary = perspectiveBary(tri.a, tri.b, tri.c, { w0, w1, w2 });
  const u = uv
    ? uv.getX(tri.i0) * bary.w0 + uv.getX(tri.i1) * bary.w1 + uv.getX(tri.i2) * bary.w2
    : 0;
  const v = uv
    ? uv.getY(tri.i0) * bary.w0 + uv.getY(tri.i1) * bary.w1 + uv.getY(tri.i2) * bary.w2
    : 0;
  // Guaranteed by the caller: `masque` is only built when `mat.alphaTest > 0 && mat.map`.
  const texture = mat.map!;
  const rgba = textureRgba(texture);
  if (!rgba) return true;
  const tx = wrapTexel(u, rgba.width, texture.wrapS),
    ty = wrapTexel(v, rgba.height, texture.wrapT);
  return rgba.data[(ty * rgba.width + tx) * 4 + 3] / 255 >= mat.alphaTest;
}

type Fill = typeof fillReference;

/** The frame loop of `visibilityRaster.ts`, on the fill it is given. */
export function rasterAvec(fill: Fill) {
  return (pages: VisPage[], cam: Parameters<typeof triangleAt>[2], viewport: [number, number]) => {
    const [width, height] = viewport,
      ids = new Uint32Array(width * height),
      depth = new Float32Array(width * height);
    depth.fill(-Infinity);
    // The compared subject is the FILL, not the camera read: the view-projection and its
    // depth convention come from the engine camera, as in the package.
    for (let pageIndex = 0; pageIndex < pages.length && pageIndex < VIS_MAX_PAGES; pageIndex++) {
      const page = pages[pageIndex],
        index = page.array;
      if (!page.attributes.position) continue;
      const side = page.material.doubleSided
        ? THREE.DoubleSide
        : page.material.backSide
          ? THREE.BackSide
          : THREE.FrontSide;
      const triangles = assertVisibilityPageTriangles((index.length / 3) | 0);
      for (let t = 0; t < triangles && t <= VIS_TRIANGLE_MASK; t++) {
        const tri = triangleAt(page, t, cam, width, height);
        if (!tri) continue;
        const area =
          (tri.b.x - tri.a.x) * (tri.c.y - tri.a.y) - (tri.c.x - tri.a.x) * (tri.b.y - tri.a.y);
        if (side !== THREE.DoubleSide) {
          if (side === THREE.BackSide) {
            if (area <= 0) continue;
          } else if (area >= 0) continue;
        }
        const mat = page.material;
        const masque: Keep | undefined =
          mat.alphaTest > 0 && mat.map
            ? (x, y, w0, w1, w2) => alphaGarde(page, tri, mat, w0, w1, w2)
            : undefined;
        const packed = packVisibilityId(pageIndex, t);
        fill(ids, depth, width, height, tri.a, tri.b, tri.c, packed, masque);
      }
    }
    for (let i = 0; i < depth.length; i++) if (depth[i] === -Infinity) depth[i] = DEPTH_CLEAR;
    return { ids, depth };
  };
}
