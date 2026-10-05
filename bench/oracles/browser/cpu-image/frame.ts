import type { DepthCamera } from '../../../../packages/sdk-browser/src/camera/depthConvention.ts';
import { triangleAt } from '../../../../packages/sdk-browser/src/visibility/math.ts';
import { type VisPage } from '../../../../packages/sdk-browser/src/visibility/types.ts';
import { DEFAULT_PIXEL_RATIO } from '../../../../packages/sdk-browser/src/backend/common.ts';
import {
  locationOf,
  type PageLocations,
} from '../../../../packages/sdk-browser/src/page/selection/placements.ts';
import { unpackVisibilityId } from './ids.ts';

type VisTriangle = NonNullable<ReturnType<typeof triangleAt>>;

/**
 * What an image must project and describe only once.
 *
 * A visibility identifier names a triangle of a page, and nothing else: its three projected
 * vertices depend only on the image camera. Projecting them at every pixel repeats the same
 * computation hundreds of times per triangle — the cache keeps the result, term for term the one
 * `triangleAt` yields, so the pixel sees exactly the same floats. The last identifier is held
 * aside: two neighbouring pixels almost always land on the same triangle, and the table is then
 * not even consulted. A page's surface is the engine record it was collected with, so the image
 * reads it as it stands instead of re-reading a host declaration per pixel.
 */
export function createVisibilityFrame(
  pages: VisPage[],
  locations: PageLocations,
  cam: DepthCamera,
  width: number,
  height: number,
  pixelRatio = DEFAULT_PIXEL_RATIO,
) {
  const triangles = new Map<number, VisTriangle | null>();
  let lastId = 0,
    last: VisTriangle | null = null;
  return {
    /** The projected triangle of an identifier, or `null`: background, missing page or triangle off the page. */
    triangle(id: number) {
      if (id === lastId) return last;
      lastId = id;
      const known = triangles.get(id);
      if (known !== undefined) return (last = known);
      const unpacked = unpackVisibilityId(id);
      const page = unpacked ? pages[unpacked.pageIndex] : undefined;
      const triangle =
        page && unpacked
          ? triangleAt(
              page,
              locationOf(locations, unpacked.pageIndex).world,
              unpacked.triangleIndex,
              cam,
              width,
              height,
              pixelRatio,
            )
          : null;
      triangles.set(id, triangle);
      return (last = triangle);
    },
    /** The page's surface record, as the collection read it once at the boundary. */
    material(page: VisPage) {
      return page.material;
    },
  };
}
export type VisibilityFrame = ReturnType<typeof createVisibilityFrame>;
