import { clamp } from '../../../../math/src/scalar/reals.ts'
import { DEFAULT_CACHED_PAGES, DEFAULT_PAGE_WORKERS } from '../../engine/common.ts'
import { configurePageWorkers } from '../../page/work/host.ts'
import type { ExplorerScene } from './prepare.ts'
import { createPageStreamerWith } from '../../streaming/pageStreamer.ts'
import type { PageQueue } from '../../streaming/types.ts'
import { worldRootsOf } from '../../scene/worldRoots.ts'
import { loadClusterPages } from '../../cluster/pages.ts'
import { createDiagnosticChannel } from '../../diagnostic/channel.ts'
import type { Engine, MeasuredWorldOptions } from '../../engine/types.ts'
import { indexManifestBundles, indexManifestPages } from '../../scene/manifestPageIndex.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'

type Progress = (phase: string, completed: number, total: number, message: string) => void

/** Hears a page read of the session that failed for good or first waits the longest: its detail
 *  and how many reads fail now (`streamFailed`). */
type Stalled = (detail: string, failedPages: number) => void

/** The pages a session preloads whole (`preload: 'all'`), read beside its queue, and what they
 *  cost; none otherwise. */
async function preloaded(
  pages: Parameters<typeof loadClusterPages>[0],
  options: MeasuredWorldOptions,
  base: string,
  signal: AbortSignal | undefined,
  progress: Progress,
) {
  const indices = new Map<string, Uint32Array>()
  if ((options.preload ?? 'visible') !== 'all') {
    progress('pages', 0, pages.length, 'Hierarchy ready · pages on demand')
    return { loaded: 0, pageBytesRead: 0, indices }
  }
  const all = await loadClusterPages(
    pages,
    base,
    signal,
    (completed, total) =>
      progress('pages', completed, total, 'Reading and checking exact and LOD pages'),
    options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
  )
  for (const [url, array] of all.indices) indices.set(url, array)
  return { loaded: all.loaded, pageBytesRead: all.pageBytesRead, indices }
}

/** The session's page sources: its queue at once (`streamer`), which its scene loads through, and
 *  the rest once the pages it preloads have landed (`sources`). A read that fails for good or first
 *  waits the longest is told to `stalled`. */
export function openExplorerPageSources(
  metadata: ClusterManifest,
  options: MeasuredWorldOptions,
  base: string,
  signal: AbortSignal | undefined,
  /** The session's engine, once built: the one an evicted page is dropped from. */
  engine: () => Engine | undefined,
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>,
  progress: Progress,
  stalled: Stalled = () => {},
) {
  const { pages, geometryPages, pageIdByUrl } = indexManifestPages(metadata)
  const exactPages = pages.filter((page) => (page.role ?? 'exact') !== 'coarse')
  // What the streamer keeps in cache; the WebGPU engine holds its own pool in bytes. A cluster DAG
  // keeps twice its bundles; a flat cache the pages the view may read, within the default ceiling.
  const bundles = indexManifestBundles(metadata)
  const flatPages =
    options.maxResidentPages ?? Math.max(1024, exactPages.length * (options.replicaCount ?? 1))
  const cacheCap =
    options.maxCachedPages ??
    (bundles.length > 0
      ? Math.max(8192, bundles.length * 2)
      : clamp(flatPages, 8192, DEFAULT_CACHED_PAGES))
  // The page worker pool never exceeds the already-in-force transfer admission.
  configurePageWorkers(options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS)
  const streamer = createPageStreamerWith([...pages, ...geometryPages, ...bundles], base, {
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
    onStalled: ({ url, cause }) => stalled(`${url}: ${String(cause)}`, streamer.stats().failed),
  })
  const preload = options.preload ?? 'visible'
  const sources = preloaded(pages, options, base, signal, progress).then((read) => ({
    ...{ pages, geometryPages, pageIdByUrl, preload, cacheCap, streamer },
    ...read,
  }))
  return { streamer, sources }
}

/** The session's page sources, once those it preloads have landed (`openExplorerPageSources`). */
export const createExplorerPageSources = (...args: Parameters<typeof openExplorerPageSources>) =>
  openExplorerPageSources(...args).sources

/** What a session reads its pages through. */
export type ExplorerPageSources = Awaited<ReturnType<typeof createExplorerPageSources>>

/** The scene the session draws — `given`, else the one `load` reads —, read through `streamer`:
 *  its partitions' index pages catalogued, and its world roots bound to the queue (`worldRootsOf`). */
export async function sceneThrough<T extends Pick<ExplorerScene, 'partitions' | 'worldRoots'>>(
  streamer: PageQueue,
  given: T | undefined,
  load: () => Promise<T>,
) {
  const scene = given ?? (await load())
  streamer.admit(scene.partitions.flatMap((cells) => cells.pages))
  for (const shown of scene.worldRoots) worldRootsOf(shown)?.bind(streamer)
  return scene
}

/** What an opening keeps of the scene source its load builds, into `owned`, while `opening` runs;
 *  one that lands after the opening failed is released at once (`release`) — the failure path ran
 *  already, no one else would — and once: the source it released stays named, never released
 *  twice. */
export function openingKeeps<T>(
  owned: { source?: T },
  opening: AbortSignal,
  release: (source: T) => void,
) {
  return (source: T) => {
    if (!opening.aborted) return void (owned.source = source)
    if (source === owned.source) return
    owned.source = source
    release(source)
  }
}
