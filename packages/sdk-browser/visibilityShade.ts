import { RASTER_BACKGROUND } from './pageRaster.ts';
import { backgroundRgb, triangleAt, uvDerivatives } from './visibilityMath.ts';
import { createVisibilityFrame } from './visibilityFrame.ts';
import { shadePixel } from './visibilityShadePixel.ts';
import { unpackVisibilityId, type VisPage } from './visibilityTypes.ts';
import type { EngineCamera } from './cameraWorld.ts';

/** Documented visbuffer beauty: MeshBasicMaterial = source color × map (same 8-bit path as rasterPages). MeshStandardMaterial = Cook-Torrance GGX microfacet BRDF with the explorer hemisphere/directional lights. */
export function shadeVisibility(
  ids: Uint32Array,
  pages: VisPage[],
  cam: EngineCamera,
  viewport: [number, number],
  background = RASTER_BACKGROUND,
) {
  const [width, height] = viewport,
    pixels = new Uint8Array(width * height * 4);
  const bg = backgroundRgb(background) as [number, number, number];
  const frame = createVisibilityFrame(pages, cam, width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = y * width + x,
        rgb = shadePixel(frame, ids[o], cam, x, y, bg);
      const p = o * 4;
      pixels[p] = rgb[0] ?? bg[0];
      pixels[p + 1] = rgb[1] ?? bg[1];
      pixels[p + 2] = rgb[2] ?? bg[2];
      pixels[p + 3] = 255;
    }
  return pixels;
}

/** Analytical UV derivatives of the winning triangle. Not a finite difference across visbuffer discontinuities. */
export function visibilityUvDerivatives(
  ids: Uint32Array,
  pages: VisPage[],
  cam: EngineCamera,
  viewport: [number, number],
  x: number,
  y: number,
) {
  const [width, height] = viewport,
    unpacked = unpackVisibilityId(ids[y * width + x]);
  if (!unpacked) return null;
  const page = pages[unpacked.pageIndex];
  if (!page) return null;
  const tri = triangleAt(page, unpacked.triangleIndex, cam, width, height);
  if (!tri) return null;
  const uv = page.attributes.uv;
  const uva: [number, number] = uv ? [uv.getX(tri.i0), uv.getY(tri.i0)] : [0, 0];
  const uvb: [number, number] = uv ? [uv.getX(tri.i1), uv.getY(tri.i1)] : [0, 0];
  const uvc: [number, number] = uv ? [uv.getX(tri.i2), uv.getY(tri.i2)] : [0, 0];
  return uvDerivatives(tri.a, tri.b, tri.c, uva, uvb, uvc, x, y);
}
