import { DEFAULT_CACHED_PAGES, DEFAULT_PAGE_WORKERS } from '../../engine/common.ts'
import { configurePageWorkers } from '../../page/work/host.ts'
import type { StreamPage } from '../../streaming/types.ts'
import { createPageStreamerWith } from '../../streaming/pageStreamer.ts'
import { loadClusterPages } from '../../cluster/pages.ts'
import { createDiagnosticChannel } from '../../diagnostic/channel.ts'
import type { Engine, MeasuredWorldOptions } from '../../engine/types.ts'
import { indexManifestBundles, indexManifestPages } from '../../scene/manifestPageIndex.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'

type Progress = (phase: string, completed: number, total: number, message: string) => void

export async function createExplorerPageSources(
  metadata: ClusterManifest,
  options: MeasuredWorldOptions,
  base: string,
  signal: AbortSignal | undefined,
  /** The session's engine, once built: the one an evicted page is dropped from. */
  engine: () => Engine | undefined,
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>,
  progress: Progress,
  /** Files read through the same queue beside the pages: a partition's cells. */
  extra: readonly StreamPage[] = [],
) {
  const { pages, geometryPages, pageIdByUrl } = indexManifestPages(metadata)
  const exactPages = pages.filter((page) => (page.role ?? 'exact') !== 'coarse')
  const preload = options.preload ?? 'visible'
  // What the streamer keeps in cache; the WebGPU engine holds its own pool in bytes. A cluster DAG
  // keeps twice its bundles; a flat cache the pages the view may read, within the default ceiling.
  const bundles = indexManifestBundles(metadata)
  const flatPages =
    options.maxResidentPages ?? Math.max(1024, exactPages.length * (options.replicaCount ?? 1))
  const cacheCap =
    options.maxCachedPages ??
    (bundles.length > 0
      ? Math.max(8192, bundles.length * 2)
      : Math.max(8192, Math.min(flatPages, DEFAULT_CACHED_PAGES)))
  // The page worker pool never exceeds the already-in-force transfer admission.
  configurePageWorkers(options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS)
  const streamer = createPageStreamerWith(
    [...pages, ...geometryPages, ...bundles, ...extra],
    base,
    {
      cache: options.pageCache,
      signal,
      workerCount: options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
      maxPages: cacheCap,
      onEvict: (url) => engine()?.dropPage(url),
      maxTransferBytes: options.maxPageTransferBytes,
      onDiagnostic:
        diagnosticChannel.detail === 'trace' && diagnosticChannel.enabled
          ? diagnosticChannel.emit
          : undefined,
    },
  )
  let loaded = 0,
    pageBytesRead = 0
  const indices = new Map<string, Uint32Array>()
  if (preload === 'all') {
    const all = await loadClusterPages(
      pages,
      base,
      signal,
      (completed, total) =>
        progress('pages', completed, total, 'Reading and checking exact and LOD pages'),
      options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
    )
    for (const [url, array] of all.indices) indices.set(url, array)
    loaded = all.loaded
    pageBytesRead = all.pageBytesRead
  } else progress('pages', 0, pages.length, 'Hierarchy ready · pages on demand')
  return {
    pages,
    geometryPages,
    pageIdByUrl,
    preload,
    cacheCap,
    streamer,
    loaded,
    pageBytesRead,
    indices,
  }
}
