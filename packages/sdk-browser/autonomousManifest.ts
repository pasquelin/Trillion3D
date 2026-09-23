import {
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  type ClusterManifest,
  type GeometryPageDescriptor,
} from '../sdk-core/src/index.ts';
import type { ClusterRoot, PageRec } from './pageSelection.ts';

/** The manifest with every page pointed at its cluster page, and those pages' descriptors by
 *  URL. The cache declares its page format once; a cache of another format, or a page without
 *  one, is refused whole. */
export function prepareAutonomousManifest(input: ClusterManifest) {
  if (
    input.geometryPages?.formatVersion !== GEOMETRY_PAGE_FORMAT_VERSION ||
    input.geometryPages.codec !== GEOMETRY_PAGE_CODEC
  )
    throw new Error('AUTONOMOUS_PAGE_MISSING');
  const descriptors = new Map<string, GeometryPageDescriptor>();
  const metadata = {
    ...input,
    primitives: input.primitives.map((primitive) => ({
      ...primitive,
      pages: primitive.pages.map((page) => {
        if (!page.geometry || page.geometry.indexCount !== page.count)
          throw new Error('AUTONOMOUS_PAGE_MISSING');
        descriptors.set(page.geometry.url, page.geometry);
        return {
          ...page,
          url: page.geometry.url,
          bytes: page.geometry.bytes,
          sha256: page.geometry.sha256,
        };
      }),
    })),
  };
  return { metadata, descriptors };
}

export function autonomousBootstrap(roots: ClusterRoot<PageRec>[]): PageRec[] {
  // The clusters nothing replaces are the coarsest complete cover; the autonomous path pins them.
  const bootstrap: PageRec[] = [];
  for (const root of roots) {
    const before = bootstrap.length;
    for (const page of root.pages) if (page.parentError == null) bootstrap.push(page);
    if (bootstrap.length === before) throw new Error('INVALID_ROOT_COVERAGE');
  }
  return bootstrap;
}
