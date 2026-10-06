import { DEFAULT_CACHED_PAGES, DEFAULT_PAGE_WORKERS } from '../../backend/common.ts'
import { configurePageDecoders } from '../../page/decode/host.ts'
import type { ExplorerScene } from './prepare.ts'
import { createPageStreamerWith } from '../../streaming/pageStreamer.ts'
import type { PageQueue } from '../../streaming/types.ts'
import { loadClusterPages } from '../../cluster/pages.ts'
import { createDiagnosticChannel } from '../../diagnostic/channel.ts'
import type { RenderBackend, MeasuredWorldOptions } from '../../backend/types.ts'
import { indexManifestBundles, indexManifestPages } from '../../scene/manifestPageIndex.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'

type Progress = (phase: string, completed: number, total: number, message: string) => void

export async function createExplorerPageSources(
  metadata: ClusterManifest,
  options: MeasuredWorldOptions,
  base: string,
  signal: AbortSignal | undefined,
  autonomous: boolean,
  backends: RenderBackend[],
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>,
  progress: Progress,
) {
  const { pages, geometryPages, geometryUrls, pageIdByUrl } = indexManifestPages(metadata)
  const exactPages = pages.filter((page) => (page.role ?? 'exact') !== 'coarse')
  const preload = options.preload ?? 'visible'
  // What host-memory engines keep resident without a host ceiling, and what the streamer
  // keeps in cache; the WebGPU engine, for its part, holds its own pool in bytes. A
  // cluster DAG cuts far below its exact page count, but the cut moves every frame: the resident
  // set must be a superset of it or the cache thrashes. Twice the expected cut, floored at 32768.
  const bundles = indexManifestBundles(metadata)
  const dagPages = bundles.length > 0
  const attachCap =
    options.maxResidentPages ??
    (dagPages
      ? Math.max(32768, exactPages.length * 2 * (options.replicaCount ?? 1))
      : Math.max(1024, exactPages.length * (options.replicaCount ?? 1)))
  const cacheCap =
    options.maxCachedPages ??
    (dagPages
      ? Math.max(8192, bundles.length * 2)
      : Math.max(8192, Math.min(attachCap, DEFAULT_CACHED_PAGES)))
  // The decode pool never exceeds the already-in-force transfer admission.
  configurePageDecoders(options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS)
  /** Who hears a failed read's wait end: the session's loop, once it runs (`whenTurned`). */
  let turned = () => {}
  const streamer = createPageStreamerWith([...pages, ...geometryPages, ...bundles], base, {
    cache: options.pageCache,
    signal,
    workerCount: options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
    maxPages: cacheCap,
    onEvict: (url) => {
      for (const b of backends) b.dropPage?.(url)
    },
    maxTransferBytes: options.maxPageTransferBytes,
    onDiagnostic:
      diagnosticChannel.detail === 'trace' && diagnosticChannel.enabled
        ? diagnosticChannel.emit
        : undefined,
    onTurn: () => turned(),
    onStalled: ({ url, cause }) =>
      diagnosticChannel.emit({
        ...{ phase: 'page-read-stalled', message: 'A read keeps failing past its longest wait' },
        context: { kind: 'error', url, error: String(cause) },
      }),
  })
  let loaded = 0,
    pageBytesRead = 0
  const indices = new Map<string, Uint32Array>()
  if (preload === 'all' && !autonomous) {
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
    geometryUrls,
    pageIdByUrl,
    preload,
    attachCap,
    cacheCap,
    streamer,
    loaded,
    pageBytesRead,
    indices,
    /** The session's loop asks the frame that holds a failed read again once its wait is over. */
    whenTurned: (wake: () => void) => void (turned = wake),
  }
}

/** `scene` read through the session's `streamer`: its partitions' index pages catalogued, and
 *  its readers — world roots, a lazy manifest's mesh pages — bound to its queue. */
export function bindScene(
  streamer: PageQueue,
  scene: Pick<ExplorerScene, 'partitions' | 'readers'>,
) {
  streamer.admit(scene.partitions.flatMap((cells) => cells.pages))
  for (const reader of scene.readers) reader.bind(streamer)
}
