import { signedArea, type Projected } from './projection.ts';
import { matrixWindingCw } from '../../../sdk-core/src/index.ts';
import { uvTransformed } from '../../../sdk-core/src/texture/contract.ts';
import { refreshSurface, surfaceSide, type PageSurface } from '../page/surface.ts';
import { lineDash } from './shader/lineWgsl.ts';
import { DEPTH_CLEAR, depthNearer } from '../camera/depthConvention.ts';
import { triangleAt, perspectiveBary, mapTexel } from './math.ts';
import {
  assertVisibilityPageTriangles,
  packVisibilityId,
  textureRgba,
  VIS_MAX_PAGES,
  VIS_TRIANGLE_MASK,
  type VisPage,
} from './types.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { HostAttributes } from '../host/resources.ts';
import { DEFAULT_PIXEL_RATIO } from '../backend/common.ts';

/** Interpolated alpha of the vertex colours; a three-component colour reads an alpha of one. */
function vertexAlpha(
  color: HostAttributes[string],
  tri: { i0: number; i1: number; i2: number },
  bary: { w0: number; w1: number; w2: number },
) {
  if (color.itemSize < 4) return 1;
  const a = (i: number) => color.getComponent(i, 3);
  return a(tri.i0) * bary.w0 + a(tri.i1) * bary.w1 + a(tri.i2) * bary.w2;
}

/**
 * What drops a pixel of a page's triangle, as the GPU rasters drop it, or nothing: a dashed line's
 * gaps (`lineDash`) at the distance its first coordinate carries, then a masked surface's cutout,
 * the base map alpha times the vertex alpha (`maskKeep`, `./shader/pageWgsl.ts`).
 */
function cutout(
  page: VisPage,
  tri: NonNullable<ReturnType<typeof triangleAt>>,
  mat: PageSurface,
  color: HostAttributes[string] | undefined,
  transformed: boolean,
) {
  const uv = page.attributes.uv,
    dashed = mat.dashSize !== undefined && !!uv,
    masked = mat.alphaTest > 0 && (!!mat.map || !!color);
  if (!dashed && !masked) return undefined;
  return (_x: number, _y: number, w0: number, w1: number, w2: number) => {
    const bary = perspectiveBary(tri.a, tri.b, tri.c, { w0, w1, w2 });
    const u = uv
      ? uv.getX(tri.i0) * bary.w0 + uv.getX(tri.i1) * bary.w1 + uv.getX(tri.i2) * bary.w2
      : 0;
    if (dashed && !lineDash(u, mat.dashSize!, mat.gapSize ?? 0)) return false;
    if (!masked) return true;
    let alpha = color ? vertexAlpha(color, tri, bary) : 1;
    const rgba = mat.map && textureRgba(mat.map);
    if (!rgba) return !color || alpha >= mat.alphaTest;
    const v = uv
      ? uv.getY(tri.i0) * bary.w0 + uv.getY(tri.i1) * bary.w1 + uv.getY(tri.i2) * bary.w2
      : 0;
    const texel = mapTexel(rgba, mat.map!, u, v, transformed);
    alpha *= rgba.data[texel + 3] / 255;
    return alpha >= mat.alphaTest;
  };
}

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
  const area = signedArea(a, b, c);
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

/** CPU visbuffer: packed IDs plus NDC z (background at the far value). Engine depth is
 *  reversed, so the GREATEST wins; at equal depth, the first write stays. A line page's quads are
 *  widened at `pixelRatio` image pixels per CSS pixel, as the GPU rasters widen them. */
export function rasterVisibility(
  pages: VisPage[],
  cam: EngineCamera,
  viewport: [number, number],
  pixelRatio = DEFAULT_PIXEL_RATIO,
) {
  const [width, height] = viewport,
    ids = new Uint32Array(width * height),
    depth = new Float32Array(width * height);
  depth.fill(-Infinity);
  for (let pageIndex = 0; pageIndex < pages.length && pageIndex < VIS_MAX_PAGES; pageIndex++) {
    const page = pages[pageIndex],
      index = page.array;
    if (!page.attributes.position) continue;
    // Once per page and per image: the host writes its raster state — a side, an alpha cutoff
    // — on the declaration it shares with its mesh, and this raster is an oracle of what it
    // declares NOW.
    const mat = refreshSurface(page.material),
      side = surfaceSide(mat);
    // A reflection reverses the walk direction on screen: the face to drop is the other one, as
    // `visBin` does for WebGPU pipelines and Three for WebGL (`frontFaceCW`). Without this
    // flip, this rasterizer drew under reflection exactly the faces that cone rejection
    // drops — and its own shading (`visibilityLighting`) already flipped the sign.
    const positif = (side === 'back') !== matrixWindingCw(page.matrix.elements);
    const transformed = !!mat.map && uvTransformed(mat.map.transform);
    // Vertex colours tint, and cut, only where the material asks, as the GPU rows do.
    const color = mat.vertexColors ? page.attributes.color : undefined;
    const triangles = assertVisibilityPageTriangles((index.length / 3) | 0);
    for (let t = 0; t < triangles && t <= VIS_TRIANGLE_MASK; t++) {
      const tri = triangleAt(page, t, cam, width, height, pixelRatio);
      if (!tri) continue;
      const area = signedArea(tri.a, tri.b, tri.c);
      if (side !== 'double' && (positif ? area <= 0 : area >= 0)) continue;
      const keep = cutout(page, tri, mat, color, transformed);
      fillIds(ids, depth, width, height, tri.a, tri.b, tri.c, packVisibilityId(pageIndex, t), keep);
    }
  }
  for (let i = 0; i < depth.length; i++) if (depth[i] === -Infinity) depth[i] = DEPTH_CLEAR;
  return { ids, depth };
}

export function rasterVisibilityIds(
  pages: VisPage[],
  cam: EngineCamera,
  viewport: [number, number],
  pixelRatio = DEFAULT_PIXEL_RATIO,
) {
  return rasterVisibility(pages, cam, viewport, pixelRatio).ids;
}
