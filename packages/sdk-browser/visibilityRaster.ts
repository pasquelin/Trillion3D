import * as THREE from 'three';
import type { Projected } from './visibilityProjection.ts';
import { HIZ_BACKGROUND } from '../sdk-core/index.ts';
import { triangleAt, perspectiveBary, wrapTexel } from './visibilityMath.ts';
import {
  assertVisibilityPageTriangles,
  packVisibilityId,
  textureRgba,
  visMaterial,
  VIS_MAX_PAGES,
  VIS_TRIANGLE_MASK,
  type VisPage,
} from './visibilityTypes.ts';

function fillIds(
  ids: Uint32Array,
  depth: Float32Array,
  width: number,
  height: number,
  a: Projected,
  b: Projected,
  c: Projected,
  packed: number,
  keep?: (x: number, y: number, w0: number, w1: number, w2: number) => boolean,
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
  // Les deux poids sont affines en x et en y : une seule division par triangle, puis un pas constant
  // par colonne et par ligne. Le balayage remplace deux divisions et quatre produits par pixel.
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
      if (z >= depth[o]) continue;
      depth[o] = z;
      ids[o] = packed;
    }
  }
}

/** CPU visbuffer: packed IDs plus NDC z (background 1). Closest z wins; equal z keeps the first write. */
export function rasterVisibility(
  pages: VisPage[],
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
) {
  const [width, height] = viewport,
    ids = new Uint32Array(width * height),
    depth = new Float32Array(width * height);
  depth.fill(Infinity);
  camera.updateMatrixWorld();
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  for (let pageIndex = 0; pageIndex < pages.length && pageIndex < VIS_MAX_PAGES; pageIndex++) {
    const page = pages[pageIndex],
      index = page.array;
    if (!page.attributes.position) continue;
    const side = visMaterial(page.material).doubleSided
      ? THREE.DoubleSide
      : Array.isArray(page.material)
        ? page.material[0].side
        : page.material.side;
    const triangles = assertVisibilityPageTriangles((index.length / 3) | 0);
    for (let t = 0; t < triangles && t <= VIS_TRIANGLE_MASK; t++) {
      const tri = triangleAt(page, t, viewProj, width, height);
      if (!tri) continue;
      const area =
        (tri.b.x - tri.a.x) * (tri.c.y - tri.a.y) - (tri.c.x - tri.a.x) * (tri.b.y - tri.a.y);
      if (side !== THREE.DoubleSide) {
        if (side === THREE.BackSide) {
          if (area <= 0) continue;
        } else if (area >= 0) continue;
      }
      const mat = visMaterial(page.material);
      if (mat.alphaTest > 0 && mat.map) {
        const uv = page.attributes.uv;
        fillIds(
          ids,
          depth,
          width,
          height,
          tri.a,
          tri.b,
          tri.c,
          packVisibilityId(pageIndex, t),
          (x, y, w0, w1, w2) => {
            const bary = perspectiveBary(tri.a, tri.b, tri.c, { w0, w1, w2 });
            const u = uv
              ? uv.getX(tri.i0) * bary.w0 + uv.getX(tri.i1) * bary.w1 + uv.getX(tri.i2) * bary.w2
              : 0;
            const v = uv
              ? uv.getY(tri.i0) * bary.w0 + uv.getY(tri.i1) * bary.w1 + uv.getY(tri.i2) * bary.w2
              : 0;
            const rgba = textureRgba(mat.map!);
            if (!rgba) return true;
            const tx = wrapTexel(u, rgba.width, mat.map!.wrapS),
              ty = wrapTexel(v, rgba.height, mat.map!.wrapT);
            return rgba.data[(ty * rgba.width + tx) * 4 + 3] / 255 >= mat.alphaTest;
          },
        );
        continue;
      }
      fillIds(ids, depth, width, height, tri.a, tri.b, tri.c, packVisibilityId(pageIndex, t));
    }
  }
  for (let i = 0; i < depth.length; i++) if (depth[i] === Infinity) depth[i] = HIZ_BACKGROUND;
  return { ids, depth };
}

export function rasterVisibilityIds(
  pages: VisPage[],
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
) {
  return rasterVisibility(pages, camera, viewport).ids;
}
