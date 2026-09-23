import { signedArea, type Projected } from './projection.ts';
import { matrixWindingCw } from '../../../sdk-core/src/index.ts';
import { refreshSurface, surfaceSide } from '../page/surface.ts';
import { DEPTH_CLEAR, depthNearer } from '../camera/depthConvention.ts';
import { triangleAt, perspectiveBary, wrapTexel } from './math.ts';
import {
  assertVisibilityPageTriangles,
  packVisibilityId,
  textureRgba,
  VIS_MAX_PAGES,
  VIS_TRIANGLE_MASK,
  type VisPage,
} from './types.ts';
import type { EngineCamera } from '../camera/world.ts';

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
 *  reversed, so the GREATEST wins; at equal depth, the first write stays. */
export function rasterVisibility(pages: VisPage[], cam: EngineCamera, viewport: [number, number]) {
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
    const triangles = assertVisibilityPageTriangles((index.length / 3) | 0);
    for (let t = 0; t < triangles && t <= VIS_TRIANGLE_MASK; t++) {
      const tri = triangleAt(page, t, cam, width, height);
      if (!tri) continue;
      const area = signedArea(tri.a, tri.b, tri.c);
      if (side !== 'double' && (positif ? area <= 0 : area >= 0)) continue;
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
  for (let i = 0; i < depth.length; i++) if (depth[i] === -Infinity) depth[i] = DEPTH_CLEAR;
  return { ids, depth };
}

export function rasterVisibilityIds(
  pages: VisPage[],
  cam: EngineCamera,
  viewport: [number, number],
) {
  return rasterVisibility(pages, cam, viewport).ids;
}
