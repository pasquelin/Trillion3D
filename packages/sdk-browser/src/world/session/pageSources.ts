import { DEFAULT_CACHED_PAGES, DEFAULT_PAGE_WORKERS } from '../../backend/common.ts';
import { configurePageDecoders } from '../../page/decode/host.ts';
import type { StreamPage } from '../../streaming/pages.ts';
import { createPageStreamerWith } from '../../streaming/pageStreamer.ts';
import { loadClusterPages } from '../../cluster/pages.ts';
import { createDiagnosticChannel } from '../../diagnostic/channel.ts';
import type { RenderBackend, MeasuredWorldOptions } from '../../backend/types.ts';
import { indexManifestBundles, indexManifestPages } from '../../scene/manifestPageIndex.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';

type Progress = (phase: string, completed: number, total: number, message: string) => void;

export async function createExplorerPageSources(
  metadata: ClusterManifest,
  options: MeasuredWorldOptions,
  base: string,
  signal: AbortSignal | undefined,
  autonomous: boolean,
  backends: RenderBackend[],
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>,
  progress: Progress,
  /** Files read through the same queue beside the pages: a partition's cells. */
  extra: readonly StreamPage[] = [],
) {
  const { pages, geometryPages, geometryUrls, pageIdByUrl } = indexManifestPages(metadata);
  const exactPages = pages.filter((page) => (page.role ?? 'exact') !== 'coarse');
  const preload = options.preload ?? 'visible';
  // What host-memory engines keep resident without a host ceiling, and what the streamer
  // keeps in cache; the WebGPU engine, for its part, holds its own pool in bytes. A
  // cluster DAG cuts far below its exact page count, but the cut moves every frame: the resident
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
  // The decode pool never exceeds the already-in-force transfer admission.
  configurePageDecoders(options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS);
  // The resident proxy is read through the same queue, so the world keeps its bytes with the
  // pages across sessions: a device lost and granted again does not fetch it twice (`proxyLoad.ts`).
  // It is `proxy.bin` in every key folder, where a page is named by its digest: it is kept under
  // its full address, or another scene the world loads would read this one's.
  const proxy = metadata.proxy && {
    ...metadata.proxy,
    url: new URL(metadata.proxy.url, base).href,
  };
  const streamer = createPageStreamerWith(
    options.pageCache,
    [...pages, ...geometryPages, ...bundles, ...extra, ...(proxy ? [proxy] : [])],
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
        progress('pages', completed, total, 'Reading and checking exact and LOD pages'),
      options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
    );
    for (const [url, array] of all.indices) indices.set(url, array);
    loaded = all.loaded;
    pageBytesRead = all.pageBytesRead;
  } else progress('pages', 0, pages.length, 'Hierarchy ready · pages on demand');
  return {
    pages,
    geometryPages,
    geometryUrls,
    pageIdByUrl,
    preload,
    attachCap,
    cacheCap,
    streamer,
    proxy,
    loaded,
    pageBytesRead,
    indices,
  };
}
