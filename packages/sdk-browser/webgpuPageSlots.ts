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
 * Two records at one address that disagreed would make one row decode index words as a page. This
 * walk is the only place both sides are read, so it is where the two are brought to one decision:
 * `settleBlendAddresses` first, then the refusal of what no placement explains — two records of the
 * same kind at one address declaring different geometry pages, which is a broken catalogue.
 */
export function describePageSlots(allPages: readonly PageRec[]) {
  const sharedIndexPages = settleBlendAddresses(allPages);
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
    sharedIndexPages,
  };
}

/**
 * Addresses where a transparent placement meets an opaque one, brought back to one decision.
 *
 * A primitive placed twice — once opaque, once `clustered-blend` — gives two records at one cluster
 * url, and only the opaque one carries a geometry page: transparency is a property of the placement
 * (`pageSelectionCollect.ts`), the page a property of the address. The pool holds ONE slot per
 * address, and the transparent placement's forward draw reads INDEX words out of that same slot
 * (`webgpuTransparentSpans.ts`, then `indices[base+local]` in `webgpuBlendShader.ts`), so the
 * address keeps its index page and the opaque record gives its page up. The record's own field is
 * cleared, and every later reader — the row's `FLAG_CLUSTER_PAGE`, the bytes a cluster still awaits
 * (`awaitsPageBytes`), the source buffers packed for it (`webgpuGeometryPrepare.ts`) and the slot's
 * content — reads that one decision from it. Returns how many records gave a page up.
 */
function settleBlendAddresses(allPages: readonly PageRec[]) {
  const blendUrls = new Set<string>();
  for (const page of allPages) if (page.transparent) blendUrls.add(page.url);
  let sharedIndexPages = 0;
  if (!blendUrls.size) return sharedIndexPages;
  for (const page of allPages)
    if (page.geometryPage && blendUrls.has(page.url)) {
      page.geometryPage = undefined;
      sharedIndexPages++;
    }
  return sharedIndexPages;
}

/**
 * True while this cluster still waits for bytes it cannot draw without.
 *
 * A cluster the cache gave a quantized geometry page draws from that page alone: the pool reads it
 * at the cluster's own address (`webgpuPagesServices.ts`) and the shaders decode it in place. Its
 * index page is never requested, never downloaded and never held on the CPU — the only number the
 * row ever wanted from it, the corner count, the geometry page declares itself.
 */
export const awaitsPageBytes = (rec: PageRec) => !rec.geometryPage && !rec.array;

/** The records of `pages` whose bytes are still awaited, collected into `into`: what the host is
 *  asked to fetch, and what an image is still missing. */
export function awaitedPages(pages: readonly PageRec[], into: PageRec[]) {
  into.length = 0;
  for (let i = 0; i < pages.length; i++) if (awaitsPageBytes(pages[i])) into.push(pages[i]);
  return into;
}
