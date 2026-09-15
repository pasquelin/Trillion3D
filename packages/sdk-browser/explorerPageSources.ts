import { DEFAULT_CACHED_PAGES, DEFAULT_PAGE_WORKERS } from './backendCommon.ts';
import { createPageStreamer } from './streamingPages.ts';
import { loadClusterPages } from './clusterPages.ts';
import { createDiagnosticChannel } from './diagnosticChannel.ts';
import type { RenderBackend, ExplorerOptions } from './backendTypes.ts';
import { indexManifestBundles, indexManifestPages } from './manifestPageIndex.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';

type Progress = (phase: string, completed: number, total: number, message: string) => void;

export async function createExplorerPageSources(
  metadata: ClusterManifest,
  options: ExplorerOptions,
  base: string,
  signal: AbortSignal | undefined,
  autonomous: boolean,
  backends: RenderBackend[],
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>,
  progress: Progress,
) {
  const { pages, geometryPages, geometryUrls, pageIdByUrl } = indexManifestPages(metadata);
  const exactPages = pages.filter((page) => (page.role ?? 'exact') !== 'coarse');
  const preload = options.preload ?? 'visible';
  // A cluster DAG cuts far below its exact page count, but the cut moves every frame: the resident
  // set must be a superset of it or the cache thrashes. Twice the expected cut, floored at 32768.
  const bundles = indexManifestBundles(metadata);
  const dagPages = bundles.length > 0;
  const attachCap =
    options.maxResidentPages ??
    (dagPages
      ? Math.max(32768, exactPages.length * 2 * (options.replicaCount ?? 1))
      : Math.max(1024, exactPages.length * (options.replicaCount ?? 1)));
  const cacheCap =
    options.maxCachedPages ??
    (dagPages
      ? Math.max(8192, bundles.length * 2)
      : Math.max(8192, Math.min(attachCap, DEFAULT_CACHED_PAGES)));
  const streamer = createPageStreamer(
    [...pages, ...geometryPages, ...bundles],
    base,
    signal,
    options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
    cacheCap,
    (url) => {
      for (const b of backends) b.dropPage?.(url);
    },
    options.maxPageTransferBytes,
    diagnosticChannel.detail === 'trace' && diagnosticChannel.enabled
      ? diagnosticChannel.emit
      : undefined,
    options.maxCachedBytes,
  );
  let loaded = 0,
    pageBytesRead = 0;
  const indices = new Map<string, Uint32Array>();
  if (preload === 'all' && !autonomous) {
    const all = await loadClusterPages(
      pages,
      base,
      signal,
      (completed, total) =>
        progress('pages', completed, total, 'Lecture et vérification des pages exactes et LOD'),
      options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
    );
    for (const [url, array] of all.indices) indices.set(url, array);
    loaded = all.loaded;
    pageBytesRead = all.pageBytesRead;
  } else progress('pages', 0, pages.length, 'Hiérarchie prête · pages à la demande');
  return {
    pages,
    geometryPages,
    geometryUrls,
    pageIdByUrl,
    preload,
    attachCap,
    cacheCap,
    streamer,
    loaded,
    pageBytesRead,
    indices,
  };
}
