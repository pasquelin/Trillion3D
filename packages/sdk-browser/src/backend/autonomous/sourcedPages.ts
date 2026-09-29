import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { setGeometryBounds } from '../../host/geometryBounds.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';
import type { BackendContext } from '../types.ts';
import type { PageRec } from '../../page/selection/selection.ts';

/**
 * THE WEBGL2 PATH'S DYNAMIC PAGES (#573). A world's dynamic geometry is paged by its index alone
 * (`world/page/runtimePrimitive.ts`): its vertices stay in the host geometry the world rewrites in
 * place. Such a page is read as its corners (`readSourcedPage`) and drawn as a geometry of those
 * corners over that host geometry's very lists (`sourcedPageGeometry`), which every page of it
 * shares: the draw uploads each list once per rewrite, by its written ranges alone
 * (`bufferSubData`, `../../webgl/cluster/buffers.ts`).
 */
export async function readSourcedPage(context: BackendContext, url: string) {
  const indices = new Uint32Array(await context.readPage!(url));
  return {
    indices,
    attributes: {},
    vertexCount: 0,
    flags: 0,
    decodedBytes: indices.byteLength,
    quantizationError: 0,
  } satisfies DecodedGeometryPage;
}

/** The geometry a dynamic page is drawn as: its corners over `source`'s own lists, bounded by
 *  the box its record declares — the primitive's held box. */
export function sourcedPageGeometry(
  indices: Uint32Array,
  source: Geometry,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  const geometry = new Geometry();
  geometry._owner = 'host';
  geometry.usage = 'dynamic';
  geometry.setIndex(new BufferAttribute(indices, 1));
  // Set as they are, not through `setAttribute`: the lists stay their geometry's, which hears them.
  Object.assign(geometry.attributes, source.attributes);
  setGeometryBounds(geometry, min, max);
  return geometry;
}

/** The host geometry a dynamic page reads its lists from; undefined for any other page. */
export function dynamicSource(rec: PageRec) {
  const source = rec.sourceMesh?.geometry as Geometry | undefined;
  return !rec.geometryPage && source?.usage === 'dynamic' ? source : undefined;
}
