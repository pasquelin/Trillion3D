import type { Page, Primitive } from '../../../../sdk-core/src/index.ts';
import type { PageCutPayload } from '../../../../sdk-core/src/page/decodeContracts.ts';
import { cutPagesOffThread } from '../../page/decode/host.ts';

/** Texture coordinates sit on the format's fixed grid of 2^-14. */
const UV_EXPONENT = -14;

/** A runtime primitive, and the addresses its pages are served from until it is released. */
export type RuntimePrimitive = { primitive: Primitive; urls: string[] };

/** Bytes served at an address of their own, with the digest the page reader checks. */
function served(bytes: ArrayBuffer, sha256: string, urls: string[]) {
  const url = URL.createObjectURL(new Blob([bytes]));
  urls.push(url);
  return { url, sha256, bytes: bytes.byteLength };
}

/** The pages of a cut, served at addresses of their own: the primitive a manifest lists. */
function servePrimitive(cut: PageCutPayload): RuntimePrimitive {
  const urls: string[] = [];
  const pages: Page[] = cut.pages.map((page, id) => ({
    id,
    ...served(page.index, page.indexSha256, urls),
    count: page.count,
    min: page.min,
    max: page.max,
    role: 'exact',
    start: page.start,
    level: 0,
    lodError: 0,
    sphere: page.sphere,
    parentError: null,
    parentSphere: null,
    group: null,
    source: null,
    geometry: {
      ...served(page.geometry, page.geometrySha256, urls),
      vertexCount: page.vertexCount,
      indexCount: page.indexCount,
      flags: page.flags,
      uncompressedBytes: page.uncompressedBytes,
    },
  }));
  const primitive: Primitive = {
    mesh: 0,
    primitive: 0,
    pass: 'exact-clusters',
    clusterStrategy: 'dag-groups',
    pages,
    structure: { version: 1, roots: pages.map((page) => page.id), groups: [] },
    quantization: {
      positionExponent: cut.positionExponent,
      uvExponent: UV_EXPONENT,
      maxPositionError: cut.maxPositionError,
    },
  };
  return { primitive, urls };
}

/**
 * Cuts drawn triangles, packed by `packDrawn` and yielded, into engine pages at run time — in the page worker, where one lives, by
 * the same function on the main thread otherwise (`runtimeCut.ts`) — and serves them. The pages
 * then enter the session like a compiled model's: read by the streamer at their address, held
 * in the same pools under the same budgets, evicted by the same rules.
 */
export async function cutRuntimePrimitive(packed: ArrayBuffer): Promise<RuntimePrimitive> {
  return servePrimitive(await cutPagesOffThread(packed));
}
