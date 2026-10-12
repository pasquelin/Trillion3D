import { DEFAULT_PAGE_WORKERS } from '../../engine/common.ts'
import { configurePageWorkers } from '../../page/work/host.ts'
import type { ExplorerScene } from './prepare.ts'
import { createPageStreamer } from '../../streaming/pageStreamer.ts'
import { createPageCache } from '../../streaming/pageCache.ts'
import { asIndices } from '../../streaming/indexView.ts'
import type { PageQueue } from '../../streaming/types.ts'
import { createDiagnosticChannel } from '../../diagnostic/channel.ts'
import type { Engine, MeasuredWorldOptions } from '../../engine/types.ts'
import { indexManifestBundles, indexManifestPages } from '../../scene/manifestPageIndex.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'
import type { PartitionCells } from '../../partition/cells.ts'
import type { WorldRootsHold } from '../../scene/worldRoots.ts'

type Progress = (phase: string, completed: number, total: number, message: string) => void

/** Hears a page read of the session that failed for good or first waits the longest: its detail
 *  and how many reads fail now (`streamFailed`). */
type Stalled = (detail: string, failedPages: number) => void

/** The index pages a session preloads whole (`preload: 'all'`), by url: read by its queue's batch
 *  request (`streamer`), through the page cache, each as it lands; none otherwise. */
async function preloaded(
  streamer: ReturnType<typeof createPageStreamer>,
  pages: readonly { url: string }[],
  preload: MeasuredWorldOptions['preload'],
  progress: Progress,
) {
  const indices = new Map<string, Uint32Array>()
  if (preload !== 'all') {
    progress('pages', 0, pages.length, 'Hierarchy ready · pages on demand')
    return indices
  }
  const urls = pages.map((page) => page.url)
  await streamer.request(urls, {
    signal: streamer.signal,
    onPage(url, bytes) {
      indices.set(url, asIndices(bytes))
      progress('pages', indices.size, urls.length, 'Reading and checking exact and LOD pages')
    },
  })
  return indices
}

/** The session's page sources: its queue at once (`streamer`), which its scene loads through, and
 *  the rest once the pages it preloads have landed (`sources`), among them the page cache the queue
 *  reads through (`pageCache`) and the index pages preloaded (`indices`). A read that fails for
 *  good or first waits the longest is told to `stalled`. */
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
  const bundles = indexManifestBundles(metadata)
  // The page worker pool never exceeds the already-in-force transfer admission.
  configurePageWorkers(options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS)
  // The one cache every reader of the session shares — its world's, kept across a device loss, or
  // the session's own —: the texture levels are held among its pages, their files read through
  // it (`createTextureLevelReader`), and the scene's proxy is kept whole there
  // (`createSceneProxyReader`). The session's own cache ends with it: emptied, its kept read
  // cancelled, as the session closes.
  const pageCache = options.pageCache ?? createPageCache()
  if (!options.pageCache) signal?.addEventListener('abort', () => pageCache.clear(), { once: true })
  const streamer = createPageStreamer([...pages, ...geometryPages, ...bundles], base, {
    cache: pageCache,
    signal,
    workerCount: options.pageFetchWorkers ?? DEFAULT_PAGE_WORKERS,
    onEvict: (url) => engine()?.dropPage(url),
    maxTransferBytes: options.maxPageTransferBytes,
    onDiagnostic:
      diagnosticChannel.detail === 'trace' && diagnosticChannel.enabled
        ? diagnosticChannel.emit
        : undefined,
    onStalled: ({ key, cause }) => stalled(`${key}: ${String(cause)}`, streamer.stats().failed),
  })
  const preload = options.preload ?? 'visible'
  const sources = preloaded(streamer, pages, preload, progress).then((indices) => ({
    ...{ pages, geometryPages, pageIdByUrl, preload, streamer, pageCache, indices },
  }))
  return { streamer, sources }
}

/** What a session reads its pages through, once those it preloads have landed
 *  (`openExplorerPageSources`). */
export type ExplorerPageSources = Awaited<ReturnType<typeof openExplorerPageSources>['sources']>

/** `partitions`' index pages catalogued by `streamer`, and the world roots bound to it. */
export function holdPartitions(
  streamer: PageQueue,
  partitions: readonly PartitionCells[],
  worldRoots: readonly WorldRootsHold[],
) {
  streamer.admit(partitions.flatMap((cells) => cells.pages))
  for (const roots of worldRoots) roots.bind(streamer)
}

/** The scene the session draws — `given`, else the one `load` reads —, read through `streamer`:
 *  its partitions' index pages catalogued, and its world roots bound to the queue. */
export async function sceneThrough<T extends Pick<ExplorerScene, 'partitions' | 'worldRoots'>>(
  streamer: PageQueue,
  given: T | undefined,
  load: () => Promise<T>,
) {
  const scene = given ?? (await load())
  holdPartitions(streamer, scene.partitions, scene.worldRoots)
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
