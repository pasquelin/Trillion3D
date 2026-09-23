import type { DepthCamera } from '../camera/depthConvention.ts';
import { triangleAt } from './math.ts';
import { unpackVisibilityId, type VisPage } from './types.ts';

export type VisTriangle = NonNullable<ReturnType<typeof triangleAt>>;

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
  cam: DepthCamera,
  width: number,
  height: number,
) {
  const triangles = new Map<number, VisTriangle | null>();
  let dernierId = 0,
    dernier: VisTriangle | null = null;
  return {
    /** The projected triangle of an identifier, or `null`: background, missing page or triangle off the page. */
    triangle(id: number) {
      if (id === dernierId) return dernier;
      dernierId = id;
      const connu = triangles.get(id);
      if (connu !== undefined) return (dernier = connu);
      const unpacked = unpackVisibilityId(id);
      const page = unpacked ? pages[unpacked.pageIndex] : undefined;
      const triangle =
        page && unpacked ? triangleAt(page, unpacked.triangleIndex, cam, width, height) : null;
      triangles.set(id, triangle);
      return (dernier = triangle);
    },
    /** The page's surface record, as the collection read it once at the boundary. */
    material(page: VisPage) {
      return page.material;
    },
  };
}
export type VisibilityFrame = ReturnType<typeof createVisibilityFrame>;
