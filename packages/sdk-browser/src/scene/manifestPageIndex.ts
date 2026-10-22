import type {
  ClusterManifest,
  Page,
  Primitive,
  StreamBundle,
} from '../../../sdk-core/src/contracts/geometry.ts'
import type { GeometryPageDescriptor } from '../../../sdk-core/src/page/contracts.ts'

/**
 * Manifest pages deduplicated by URL in a single pass: the geometry pages, each a slice of its
 * streaming bundle, and the index pages of a cache that carries no geometry page. A page with its
 * geometry is read as that geometry page alone, never by a URL of its own. Tables preserve, as
 * `new Map(entries)`, the last value of a URL instead of its first appearance, and `values()`
 * returns that appearance order.
 */
export function indexManifestPages(metadata: ClusterManifest) {
  const pageByUrl = new Map<string, Page>()
  const geometryByUrl = new Map<string, GeometryPageDescriptor>()
  const geometryIdByUrl = new Map<string, number>()
  for (const primitive of metadata.primitives)
    for (const page of primitive.pages) {
      if (!page.geometry) pageByUrl.set(page.url, page)
      else {
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

/** The pages a primitive is read through, as the streamer catalogues them: its geometry pages, or
 *  the index pages of a cache without them, and the bundles that carry them. */
export function primitivePages(primitive: Primitive) {
  const pages: (Page | GeometryPageDescriptor | StreamBundle)[] = []
  for (const page of primitive.pages) pages.push(page.geometry ?? page)
  for (const bundle of primitive.streams?.pages ?? []) pages.push(bundle)
  return pages
}

/** The object each page url of the manifest belongs to, as its primitive's place in the manifest:
 *  the pages and bundles a primitive is read through (`primitivePages`), those of a primitive
 *  joined to the manifest later too. A url the manifest does not name belongs to none. */
export function indexManifestObjects(metadata: ClusterManifest) {
  const objectByUrl = new Map<string, number>()
  let indexed = 0
  return (url: string) => {
    for (; indexed < metadata.primitives.length; indexed++)
      for (const page of primitivePages(metadata.primitives[indexed]))
        objectByUrl.set(page.url, indexed)
    return objectByUrl.get(url)
  }
}

/** Manifest streaming bundles, deduplicated by URL, in order of appearance. */
export function indexManifestBundles(metadata: ClusterManifest) {
  const bundleByUrl = new Map<string, StreamBundle>()
  for (const primitive of metadata.primitives)
    for (const bundle of primitive.streams?.pages ?? []) bundleByUrl.set(bundle.url, bundle)
  return [...bundleByUrl.values()]
}
