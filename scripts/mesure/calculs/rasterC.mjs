// Les deux remplissages du visbuffer que le lot C compare, et la boucle d'image qui les appelle.
// `fillReference` est `visibilityRaster.ts:15-64` recopié tel quel, ce que le paquet fait ;
// `fillAffine` est le candidat refusé, une division par triangle et des pas constants. Les garder
// côte à côte est ce qui rend le refus reproductible.
import * as THREE from 'three';
import { HIZ_BACKGROUND } from '../../../packages/sdk-core/index.ts';
import {
  perspectiveBary,
  triangleAt,
  wrapTexel,
} from '../../../packages/sdk-browser/visibilityMath.ts';
import {
  assertVisibilityPageTriangles,
  packVisibilityId,
  textureRgba,
  visMaterial,
  VIS_MAX_PAGES,
  VIS_TRIANGLE_MASK,
} from '../../../packages/sdk-browser/visibilityTypes.ts';

/** `visibilityRaster.ts:15-64` : une division par poids et par pixel, ce que le paquet fait. */
export function fillReference(ids, depth, width, height, a, b, c, packed, keep) {
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
      if (z >= depth[o]) continue;
      depth[o] = z;
      ids[o] = packed;
    }
  }
}

/** Le candidat refusé : les poids sont affines, une seule division par triangle. */
export function fillAffine(ids, depth, width, height, a, b, c, packed, keep) {
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
      if (z >= depth[o]) continue;
      depth[o] = z;
      ids[o] = packed;
    }
  }
}

/** Le test alpha du remplissage, le même des deux côtés : il lit les poids qu'on lui passe. */
function alphaGarde(page, tri, mat, w0, w1, w2) {
  const uv = page.attributes.uv;
  const bary = perspectiveBary(tri.a, tri.b, tri.c, { w0, w1, w2 });
  const u = uv
    ? uv.getX(tri.i0) * bary.w0 + uv.getX(tri.i1) * bary.w1 + uv.getX(tri.i2) * bary.w2
    : 0;
  const v = uv
    ? uv.getY(tri.i0) * bary.w0 + uv.getY(tri.i1) * bary.w1 + uv.getY(tri.i2) * bary.w2
    : 0;
  const rgba = textureRgba(mat.map);
  if (!rgba) return true;
  const tx = wrapTexel(u, rgba.width, mat.map.wrapS),
    ty = wrapTexel(v, rgba.height, mat.map.wrapT);
  return rgba.data[(ty * rgba.width + tx) * 4 + 3] / 255 >= mat.alphaTest;
}

/** `visibilityRaster.ts:67-135` : la boucle d'image, sur le remplissage qu'on lui donne. */
export function rasterAvec(fill) {
  return (pages, cam, viewport) => {
    const [width, height] = viewport,
      ids = new Uint32Array(width * height),
      depth = new Float32Array(width * height);
    depth.fill(Infinity);
    cam.updateMatrixWorld();
    const viewProj = new THREE.Matrix4().multiplyMatrices(
      cam.projectionMatrix,
      cam.matrixWorldInverse,
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
        const masque =
          mat.alphaTest > 0 && mat.map
            ? (x, y, w0, w1, w2) => alphaGarde(page, tri, mat, w0, w1, w2)
            : undefined;
        const packed = packVisibilityId(pageIndex, t);
        fill(ids, depth, width, height, tri.a, tri.b, tri.c, packed, masque);
      }
    }
    for (let i = 0; i < depth.length; i++) if (depth[i] === Infinity) depth[i] = HIZ_BACKGROUND;
    return { ids, depth };
  };
}
