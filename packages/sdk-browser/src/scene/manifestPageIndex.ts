import type {
  ClusterManifest,
  GeometryPageDescriptor,
  Page,
  Primitive,
  StreamBundle,
} from '../../../sdk-core/src/index.ts'

/**
 * Manifest pages deduplicated by URL in a single pass. Four `flatMap` built four complete
 * copies before deduplicating three of them. Tables preserve, as `new Map(entries)`, the last value
 * of a URL instead of its first appearance, and `values()` returns that appearance order: order
 * and contents remain unchanged.
 */
export function indexManifestPages(metadata: ClusterManifest) {
  const pageByUrl = new Map<string, Page>()
  const geometryByUrl = new Map<string, GeometryPageDescriptor>()
  const geometryIdByUrl = new Map<string, number>()
  for (const primitive of metadata.primitives)
    for (const page of primitive.pages) {
      pageByUrl.set(page.url, page)
      if (page.geometry) {
        geometryByUrl.set(page.geometry.url, page.geometry)
        geometryIdByUrl.set(page.geometry.url, page.id)
      }
    }
  const pages = [...pageByUrl.values()]
  const pageIdByUrl = new Map<string, number>()
  for (const page of pages) pageIdByUrl.set(page.url, page.id)
  for (const [url, id] of geometryIdByUrl) pageIdByUrl.set(url, id)
  return {
    pages,
    geometryPages: [...geometryByUrl.values()],
    pageIdByUrl,
  }
}

/** The pages a primitive is read through, as the streamer catalogues them: its index pages, its
 *  geometry pages and the bundles that carry them. */
export function primitivePages(primitive: Primitive) {
  const pages: (Page | GeometryPageDescriptor | StreamBundle)[] = [...primitive.pages]
  for (const page of primitive.pages) if (page.geometry) pages.push(page.geometry)
  for (const bundle of primitive.streams?.pages ?? []) pages.push(bundle)
  return pages
}

/** Manifest streaming bundles, deduplicated by URL, in order of appearance. */
export function indexManifestBundles(metadata: ClusterManifest) {
  const bundleByUrl = new Map<string, StreamBundle>()
  for (const primitive of metadata.primitives)
    for (const bundle of primitive.streams?.pages ?? []) bundleByUrl.set(bundle.url, bundle)
  return [...bundleByUrl.values()]
}
