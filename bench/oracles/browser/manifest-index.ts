// Batch F oracles, page-source side: `packages/sdk-browser/src/world/session/pageSources.ts:20-49` from before
// batch F, copied as-is. No host library here: the unit tests read these.
import type {
  ClusterManifest,
  GeometryPageDescriptor,
  Page,
} from '../../../packages/sdk-core/src/index.ts';

/** A manifest page whose optional `geometry` descriptor is present. */
type PageWithGeometry = Page & { geometry: GeometryPageDescriptor };
const hasGeometry = (page: Page): page is PageWithGeometry => !!page.geometry;

/** `createExplorerPageSources` before batch F: four `flatMap` over every page of the manifest. */
export function referenceIndexManifestPages(metadata: ClusterManifest) {
  const pages = [
    ...new Map(metadata.primitives.flatMap((p) => p.pages).map((p) => [p.url, p])).values(),
  ];
  const geometryPages = [
    ...new Map(
      metadata.primitives
        .flatMap((p) => p.pages)
        .filter(hasGeometry)
        .map((page) => [page.geometry.url, page.geometry]),
    ).values(),
  ];
  const geometryUrls = new Set(geometryPages.map((page) => page.url));
  const pageIdByUrl = new Map<string, number>([
    ...pages.map((page): [string, number] => [page.url, page.id]),
    ...metadata.primitives
      .flatMap((p) => p.pages)
      .filter(hasGeometry)
      .map((page): [string, number] => [page.geometry.url, page.id]),
  ]);
  return { pages, geometryPages, geometryUrls, pageIdByUrl };
}

/** Streaming bundles before batch F: one more `flatMap`. */
export function referenceIndexManifestBundles(metadata: ClusterManifest) {
  return [
    ...new Map(
      metadata.primitives
        .flatMap((p) => p.streams?.pages ?? [])
        .map((bundle) => [bundle.url, bundle]),
    ).values(),
  ];
}
