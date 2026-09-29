/**
 * The pages the WebGL2 autonomous records draw (`geometry.ts`): a page read from the cache, one
 * the host replaced (#837), or one cut again for a record's new class (#846), each checked against
 * its descriptor and its records' boxes before a record draws it.
 */
import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import { colouredTwin, hostPageBytes, hostPageGeometry } from '../../host/pageObjects.ts';
import type { HostMaterial, HostMaterials } from '../../host/resources.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';
import type { ClusterRoot, PageRec } from '../../page/selection/selection.ts';
import { rowPlaced } from '../../placement/autonomousPlacements.ts';
import { wearDeclaration } from '../../page/surface.ts';
import { assertWithinBox, itemSize, pageOf } from './pageData.ts';
import { dynamicSource, sourcedPageGeometry } from './sourcedPages.ts';

type PageStoreEnvironment = {
  /** The roots a record's `placementIndex` ranks: whether a row places it is its root's. */
  roots: readonly ClusterRoot<PageRec>[];
  byUrl: Map<string, PageRec[]>;
  descriptors: Map<string, GeometryPageDescriptor>;
  baseMaterials: Map<PageRec, HostMaterials>;
  colorMaterials: Map<HostMaterial, HostMaterial>;
  modifiedPages: Set<string>;
  state: { allocationBytes: number; residentPages: number };
  /** Detaches a record and frees its geometry unless `keep` (`geometry.ts`). */
  release(rec: PageRec, keep?: boolean): void;
  /** The one writer of a record's index array (`geometry.ts`). */
  setArray(rec: PageRec, array: Uint32Array | undefined): void;
};

export function createPageStore(env: PageStoreEnvironment) {
  const { byUrl, descriptors, baseMaterials, colorMaterials, modifiedPages, state } = env;
  const { release, setArray } = env;
  /** The pages the host replaced, as it wrote them: a record that joins one later — a mount —
   *  draws the host's page, never the cache's, and neither do the others then (#837). */
  const replaced = new Map<string, DecodedGeometryPage>();
  /** Each record draws the host's page where it replaced it (#837, `read` as `host` writes it),
   *  else its class's recut (`pageOf`), else `read`. Rowed records share one geometry per page. */
  const storeRecords = (recs: readonly PageRec[], read?: DecodedGeometryPage, host = false) => {
    const rowed = new Map<DecodedGeometryPage, ReturnType<typeof hostPageGeometry>>(),
      storing = new Set(recs);
    // A rowed geometry another record of the page still draws stays: some records restored alone.
    const drawnByOthers = (rec: PageRec) =>
      (byUrl.get(rec.url) ?? []).some(
        (other) => other.geometry === rec.geometry && !storing.has(other),
      );
    for (const rec of recs) {
      const placed = rowPlaced(env.roots, rec);
      release(rec, placed && drawnByOthers(rec));
      const data = host ? read! : (replaced.get(rec.url) ?? pageOf(rec, read)),
        shared = placed ? rowed.get(data) : undefined,
        // A dynamic page, its index alone: drawn over its primitive's own lists (#573).
        source = dynamicSource(rec);
      if (!shared && !source) assertWithinBox(data, rec);
      const geometry =
        shared ??
        (source
          ? sourcedPageGeometry(data.indices, source, rec.min, rec.max)
          : hostPageGeometry(
              data,
              (name) =>
                name.startsWith('skin')
                  ? data.attributes[name].length / data.vertexCount
                  : itemSize(name),
              rec.min,
              rec.max,
            ));
      if (placed) rowed.set(data, geometry);
      const base = baseMaterials.get(rec)!;
      // Lazily: a page without a colour attribute must not make a vertex-coloured twin.
      const twin = (one: HostMaterial) => colouredTwin(colorMaterials, one);
      const paint = () => (Array.isArray(base) ? base.map(twin) : twin(base));
      wearDeclaration(rec, geometry.attributes.color ? paint() : base);
      setArray(rec, data.indices);
      rec.attributes = geometry.attributes;
      rec.geometry = geometry;
      // Each geometry uploads its own buffers: counted as `release` gives them back.
      if (!shared) state.allocationBytes += hostPageBytes(geometry);
    }
  };
  /** Stores `given`, or the host's page where it replaced this one; `host` replaces it. */
  const storeGeometryPage = (url: string, given: DecodedGeometryPage, host = false) => {
    const recs = byUrl.get(url);
    if (!recs) return false;
    const data = host ? given : (replaced.get(url) ?? given);
    const descriptor = descriptors.get(url);
    // A dynamic page (`sourcedPages.ts`) has no descriptor: its corners are all it carries.
    const dynamic = !descriptor && !!recs[0] && !!dynamicSource(recs[0]);
    if (
      !dynamic &&
      (!descriptor ||
        data.vertexCount !== descriptor.vertexCount ||
        data.indices.length !== descriptor.indexCount ||
        data.flags !== descriptor.flags)
    )
      throw new Error('AUTONOMOUS_PAGE_METADATA_MISMATCH');
    if (recs[0] && !recs[0].array) state.residentPages++;
    storeRecords(recs, data, host);
    // Kept once every check passed: a refused page never stands in for the cache's.
    if (host) replaced.set(url, given);
    return recs.length > 0;
  };
  // True when the store now holds the page: the host did not replace it, and a record draws it.
  const acceptGeometryPage = (url: string, data: DecodedGeometryPage) =>
    !modifiedPages.has(url) && storeGeometryPage(url, data);
  return {
    storeGeometryPage,
    /** Records that joined pages the host replaced — a mount's — draw the host's pages. */
    storeReplaced(urls: readonly string[]) {
      for (const url of urls) {
        const data = replaced.get(url);
        if (data) storeGeometryPage(url, data);
      }
    },
    /** Resident records draw their page again, as a class change cut it (#846): `read`, the
     *  page's own, for those that draw it — or the host's, where it replaced that page (#837). */
    restoreRecords: (recs: readonly PageRec[], read?: DecodedGeometryPage) =>
      storeRecords(recs, read),
    acceptGeometryPage,
  };
}
