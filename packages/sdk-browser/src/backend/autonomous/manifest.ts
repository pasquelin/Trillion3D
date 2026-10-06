import {
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  type ClusterManifest,
  type GeometryPageDescriptor,
  type Page,
} from '../../../../sdk-core/src/index.ts'
import { readSourcedPage } from './sourcedPages.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/selection.ts'
import { decodePageOffThread } from '../../page/decode/host.ts'
import type { BackendContext } from '../types.ts'

/** The manifest with every page pointed at its cluster page, and those pages' descriptors by
 *  URL. The cache declares its page format once; a cache of another format, or a page without
 *  one, is refused whole — save a dynamic primitive's, paged by its index alone (`sourced`,
 *  `sourcedPages.ts`). */
export function prepareAutonomousManifest(input: ClusterManifest) {
  if (
    input.geometryPages?.formatVersion !== GEOMETRY_PAGE_FORMAT_VERSION ||
    input.geometryPages.codec !== GEOMETRY_PAGE_CODEC
  )
    throw new Error('AUTONOMOUS_PAGE_MISSING')
  const descriptors = new Map<string, GeometryPageDescriptor>(),
    sourced = new Map<string, Page>()
  const metadata = {
    ...input,
    primitives: input.primitives.map((primitive) => ({
      ...primitive,
      pages: primitive.pages.map((page) => {
        if (primitive.dynamic && !page.geometry) return sourced.set(page.url, page) && page
        if (!page.geometry || page.geometry.indexCount !== page.count)
          throw new Error('AUTONOMOUS_PAGE_MISSING')
        descriptors.set(page.geometry.url, page.geometry)
        return {
          ...page,
          url: page.geometry.url,
          bytes: page.geometry.bytes,
          sha256: page.geometry.sha256,
        }
      }),
    })),
  }
  return { metadata, descriptors, sourced }
}

/** The root cover the open draws before any cut, each page with its packed rank (#1235): a spread
 *  over the roots would overflow the stack. Writes `shown` and `shownPacked` in place. */
export function showRootCover(
  roots: readonly ClusterRoot<PageRec>[],
  shown: PageRec[],
  shownPacked: number[],
) {
  for (let rank = 0; rank < roots.length; rank++) {
    const root = roots[rank]
    for (let p = 0; p < root.pages.length; p++)
      if (root.pages[p].parentError == null) {
        shown.push(root.pages[p])
        shownPacked.push((root.packedBase ?? 0) + p)
      }
  }
}

export function autonomousBootstrap(roots: ClusterRoot<PageRec>[]): PageRec[] {
  // The clusters nothing replaces are the coarsest complete cover; the autonomous path pins them.
  const bootstrap: PageRec[] = []
  for (const root of roots) {
    const before = bootstrap.length
    for (const page of root.pages) if (page.parentError == null) bootstrap.push(page)
    if (bootstrap.length === before) throw new Error('INVALID_ROOT_COVERAGE')
  }
  return bootstrap
}

/** The pages at `urls`, read and decoded off the main thread — the open's root cover, or a
 *  mount's (`../../world/scene/partitionMounts.ts`) —, the session's abort checked around each read; a `sourced` one read as
 *  its corners (`readSourcedPage`). */
export const readPages = (
  context: BackendContext,
  urls: readonly string[],
  sourced: ReadonlyMap<string, unknown> = new Map(),
) =>
  Promise.all(
    urls.map(async (url) => {
      context.signal?.throwIfAborted()
      if (sourced.has(url)) return readSourcedPage(context, url)
      const bytes = await context.readGeometryPage!(url)
      context.signal?.throwIfAborted()
      return decodePageOffThread(bytes, context.signal)
    }),
  )
