import type { PageRec } from './pageSelection.ts';

/**
 * What the geometry pool holds for the scene, walked once from the catalogue.
 *
 * A slot holds a cluster's quantized geometry page where the cache carries one, its index page
 * otherwise, and it is as wide as the widest of them, so any admitted page fits. That width is a
 * BYTE count and says nothing about how many corners a cluster draws: a page under twelve packed
 * bytes per triangle is narrower than its own corner list. The draw ceiling is therefore the
 * catalogue's largest corner count, taken here and nowhere else — a draw bounded by the slot's
 * word count would silently drop the tail triangles of every cluster the format compresses well.
 *
 * The slot's content is chosen per cluster ADDRESS (`geometryUrls`), while the row's
 * `FLAG_CLUSTER_PAGE` is decided per RECORD (`webgpuPageRowMaterial.ts`, from `rec.geometryPage`).
 * Two records at one address that disagreed — one placement of a primitive opaque, another
 * transparent — would make one row decode index words as a page. This walk is the only place both
 * sides are read, so it is where the disagreement is refused.
 */
export function describePageSlots(allPages: readonly PageRec[]) {
  const geometryUrls = new Map<string, string>(),
    seenUrls = new Set<string>();
  let pageBytes = 4,
    maxCorners = 1,
    fromGeometryPage = 0,
    fromSourceGeometry = 0,
    transparentClusters = 0;
  for (const page of allPages) {
    const geometry = page.geometryPage;
    if (seenUrls.has(page.url) && geometryUrls.get(page.url) !== geometry?.url)
      throw new Error(`CLUSTER_PAGE_DISAGREEMENT: ${page.url}`);
    seenUrls.add(page.url);
    if (geometry) {
      geometryUrls.set(page.url, geometry.url);
      fromGeometryPage++;
    } else if (page.transparent) transparentClusters++;
    else fromSourceGeometry++;
    const n = geometry ? geometry.bytes : (page.array?.byteLength ?? page.indexBytes);
    const padded = n + (n % 4 ? 4 - (n % 4) : 0);
    if (padded > pageBytes) pageBytes = padded;
    const corners = geometry ? geometry.indexCount : page.triangles * 3;
    if (corners > maxCorners) maxCorners = corners;
  }
  return {
    geometryUrls,
    pageBytes,
    maxCorners,
    fromGeometryPage,
    fromSourceGeometry,
    transparentClusters,
  };
}
