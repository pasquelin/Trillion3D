// Oracles, page-source side: `packages/sdk-browser/src/session/pageSources.ts:20-49`, copied as-is. No host library here: the unit tests read these.
import type { ClusterManifest, Page } from '../../../packages/sdk-core/src/contracts/geometry.ts'
import type { GeometryPageDescriptor } from '../../../packages/sdk-core/src/page/contracts.ts'

/** A manifest page whose optional `geometry` descriptor is present. */
type PageWithGeometry = Page & { geometry: GeometryPageDescriptor }
const hasGeometry = (page: Page): page is PageWithGeometry => !!page.geometry

/** `openExplorerPageSources`: four `flatMap` over every page of the manifest. A page with its
 *  geometry is read as that geometry page alone, never by a URL of its own (manifest 13). */
export function referenceIndexManifestPages(metadata: ClusterManifest) {
  const pages = [
    ...new Map(
      metadata.primitives
        .flatMap((p) => p.pages)
        .filter((page) => !hasGeometry(page))
        .map((p) => [p.url, p]),
    ).values(),
  ]
  const geometryPages = [
    ...new Map(
      metadata.primitives
        .flatMap((p) => p.pages)
        .filter(hasGeometry)
        .map((page) => [page.geometry.url, page.geometry]),
    ).values(),
  ]
  const pageIdByUrl = new Map<string, number>([
    ...pages.map((page): [string, number] => [page.url, page.id]),
    ...metadata.primitives
      .flatMap((p) => p.pages)
      .filter(hasGeometry)
      .map((page): [string, number] => [page.geometry.url, page.id]),
  ])
  return { pages, geometryPages, pageIdByUrl }
}

/** Streaming bundles: one more `flatMap`. */
export function referenceIndexManifestBundles(metadata: ClusterManifest) {
  return [
    ...new Map(
      metadata.primitives
        .flatMap((p) => p.streams?.pages ?? [])
        .map((bundle) => [bundle.url, bundle]),
    ).values(),
  ]
}
