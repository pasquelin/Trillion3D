// The frame loop of `visibility/raster.ts`, on the fill it is given, and the alpha test both fills
// share: split from `rasterBuffer.ts`, which holds the two fills themselves.
import * as THREE from 'three';
import { DEPTH_CLEAR } from '../../../../packages/sdk-browser/src/camera/depthConvention.ts';
import {
  perspectiveBary,
  triangleAt,
  wrapTexel,
} from '../../../../packages/sdk-browser/src/visibility/math.ts';
import {
  assertVisibilityPageTriangles,
  packVisibilityId,
  textureRgba,
  VIS_MAX_PAGES,
  VIS_TRIANGLE_MASK,
  type VisMaterial,
  type VisPage,
} from '../../../../packages/sdk-browser/src/visibility/types.ts';
import type { fillReference, Keep } from './rasterBuffer.ts';

type Triangle = NonNullable<ReturnType<typeof triangleAt>>;

/** The fill's alpha test, the same on both sides: it reads the weights it is given. */
function alphaKeep(
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
  // Guaranteed by the caller: `mask` is only built when `mat.alphaTest > 0 && mat.map`.
  const texture = mat.map!;
  const rgba = textureRgba(texture);
  if (!rgba) return true;
  const tx = wrapTexel(u, rgba.width, texture.wrapS),
    ty = wrapTexel(v, rgba.height, texture.wrapT);
  return rgba.data[(ty * rgba.width + tx) * 4 + 3] / 255 >= mat.alphaTest;
}

type Fill = typeof fillReference;

/** The frame loop of `packages/sdk-browser/src/visibility/raster.ts`, on the fill it is given. */
export function rasterWith(fill: Fill) {
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
        const mask: Keep | undefined =
          mat.alphaTest > 0 && mat.map
            ? (x, y, w0, w1, w2) => alphaKeep(page, tri, mat, w0, w1, w2)
            : undefined;
        const packed = packVisibilityId(pageIndex, t);
        fill(ids, depth, width, height, tri.a, tri.b, tri.c, packed, mask);
      }
    }
    for (let i = 0; i < depth.length; i++) if (depth[i] === -Infinity) depth[i] = DEPTH_CLEAR;
    return { ids, depth };
  };
}
