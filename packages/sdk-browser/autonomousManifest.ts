import {
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  type ClusterManifest,
} from '../sdk-core/index.ts';
import type { ClusterRoot, PageRec } from './pageSelection.ts';

export function prepareAutonomousManifest(input: ClusterManifest) {
  const metadata = {
    ...input,
    primitives: input.primitives.map((primitive) => ({
      ...primitive,
      pages: primitive.pages.map((page) => {
        if (
          !page.geometry ||
          page.geometry.formatVersion !== GEOMETRY_PAGE_FORMAT_VERSION ||
          page.geometry.codec !== GEOMETRY_PAGE_CODEC ||
          page.geometry.indexCount !== page.count
        )
          throw new Error('AUTONOMOUS_PAGE_MISSING');
        return {
          ...page,
          url: page.geometry.url,
          bytes: page.geometry.bytes,
          sha256: page.geometry.sha256,
        };
      }),
    })),
  };
  const descriptors = new Map(
    input.primitives
      .flatMap((primitive) => primitive.pages)
      .filter((page) => !!page.geometry)
      .map((page) => [page.geometry!.url, page.geometry!] as const),
  );
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
