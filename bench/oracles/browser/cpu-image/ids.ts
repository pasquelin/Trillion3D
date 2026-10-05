import {
  VIS_MAX_PAGE_TRIANGLES,
  VIS_TRIANGLE_BITS,
  VIS_TRIANGLE_MASK,
} from '../../../../packages/sdk-browser/src/visibility/visWords.ts';
import { VIS_MAX_PAGES } from '../../../../packages/sdk-browser/src/visibility/types.ts';

/** The identifier of a pixel no page drew: the background. */
export const VIS_INVALID = 0;

type UnpackedVisibility = { pageIndex: number; triangleIndex: number };

/**
 * CPU mirror of the packing the shaders write inline (`page.packedBase|(triangle&0xffu)` in
 * `visibility/shader/visWgsl.ts` and `gpu/raster/pixelWgsl.ts`, `id>>8u` / `id&0xffu` at unpack in
 * `visibility/shader/shadeWgsl.ts`). Two languages: the text is not shared, the layout is.
 */
export function packVisibilityId(pageIndex: number, triangleIndex: number) {
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= VIS_MAX_PAGES ||
    !Number.isInteger(triangleIndex) ||
    triangleIndex < 0 ||
    triangleIndex > VIS_TRIANGLE_MASK
  )
    throw new Error('VISIBILITY_ID_RANGE');
  // The page field reaches past 2^31, so the shift is done in floating point and forced unsigned.
  return ((pageIndex + 1) * VIS_MAX_PAGE_TRIANGLES + (triangleIndex & VIS_TRIANGLE_MASK)) >>> 0;
}

export function unpackVisibilityId(id: number): UnpackedVisibility | null {
  if (id === VIS_INVALID) return null;
  return { pageIndex: (id >>> VIS_TRIANGLE_BITS) - 1, triangleIndex: id & VIS_TRIANGLE_MASK };
}
