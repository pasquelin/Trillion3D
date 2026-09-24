import type * as G from '../../host/graph/graph.fixture.ts';
import { encodeGeometryPage } from '../../../../page-codec/geometryPage.ts';
import type { PageAttributes } from '../../../../page-codec/pageAttributes.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';

/** The graph attributes a page carries, by their page name. */
const NAMES = [
  ['POSITION', 'position'],
  ['NORMAL', 'normal'],
  ['TEXCOORD_0', 'uv'],
] as const;

/** Encoded page of one geometry: its source triangles `[start, start + count)`. */
function encodePage(geometry: G.GraphGeometry, start: number, count: number) {
  const attributes: PageAttributes = {};
  for (const [page, graph] of NAMES) {
    const attribute = geometry.getAttribute(graph);
    if (attribute) attributes[page] = { itemSize: attribute.itemSize, array: attribute.array };
  }
  return encodeGeometryPage(geometry.index!.array.slice(start, start + count), attributes);
}

/**
 * The manifest a WebGL2 autonomous engine reads: each page of `metadata` encoded from the
 * geometry of its mesh (`geometries[primitive.mesh]`) at `<page url>-geometry.bin`, the encoded
 * pages by that url, and the reader that serves them.
 */
export function pagedManifest(metadata: ClusterManifest, geometries: readonly G.GraphGeometry[]) {
  const encoded = new Map<string, ReturnType<typeof encodeGeometryPage>>();
  const primitives = metadata.primitives.map((primitive) => ({
    ...primitive,
    pages: primitive.pages.map((page) => {
      const url = `${page.url}-geometry.bin`,
        bytes = encodePage(geometries[primitive.mesh], page.start ?? 0, page.count);
      encoded.set(url, bytes);
      const { data, vertexCount, indexCount, flags, uncompressedBytes } = bytes;
      const descriptor = { vertexCount, indexCount, flags, uncompressedBytes };
      return { ...page, geometry: { url, sha256: 'x', bytes: data.length, ...descriptor } };
    }),
  }));
  return {
    metadata: {
      ...metadata,
      geometryPages: { formatVersion: 3 as const, codec: 'quantized' as const },
      primitives,
    } as ClusterManifest,
    encoded,
    readGeometryPage: async (url: string) => encoded.get(url)!.data,
  };
}
