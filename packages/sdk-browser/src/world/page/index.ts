import type { PageSource } from '../../../../sdk-core/src/index.ts'
import { createGpuPageCache } from '../../gpu/page/pages.ts'
import { families } from '../../host/families.ts'
import { DEFAULT_PAGE_WORKERS } from '../../engine/common.ts'
import { createPageStreamer } from '../../streaming/pageStreamer.ts'
import type { PageCache } from '../../streaming/pageCache.ts'
import type { StreamPage } from '../../streaming/types.ts'
import { loadedSdkWasm } from '../../wasm/sdkWasm.ts'

/** Where pages are read from, and the address they are read against. */
export type WorldPageSource = PageSource & {
  /** The address every page is read against. */
  readonly baseUrl: string
}

/** How a model's pages are fetched: from which source, by how many workers at once. */
export interface PageStreamer {
  /** Where the pages are read from. */
  readonly source: WorldPageSource
  /** How many workers fetch and decode pages at once. */
  readonly workers: number
}

/**
 * The `page` family: geometry cut into pages, which enter and leave memory by what the frame
 * reads. `createCache` is the GPU page pool (`createGpuPageCache`), `decode` the cluster page
 * decoder (`decodeGeometryPage`), a chunk of its own the first call downloads: the engine draws
 * pages on the GPU and never decodes one on the CPU.
 */
export const page = {
  /**
   * A page source that reads the pages `p.pages` lists over HTTP from `baseUrl`, through the
   * engine's page streaming (`createPageStreamer`): one bounded queue ordered by each read's
   * `priority`, over `p.cache`, the host cache its owner shares with every reader
   * (`createPageCache`). Each page is checked against its size and fingerprint as it lands, then by
   * the geometry page format's own gate (`checkGeometryPage`, the engine's source's too:
   * `webgpu/pages/readPage.ts`) before it is handed on: a GPU page pool uploads its words as they
   * are. The gate is the page decoder's chunk, downloaded beside the first read. `dispose` cancels
   * its reads; the cache stays its owner's.
   * @param baseUrl - The address pages are read against.
   * @param p - The pages it may read, and the host cache it reads through.
   */
  httpSource: (
    baseUrl: string,
    p: { pages: readonly StreamPage[]; cache: PageCache },
  ): WorldPageSource & { dispose(): void } => {
    const streamer = createPageStreamer(p.pages, baseUrl, {
      cache: p.cache,
      workerCount: DEFAULT_PAGE_WORKERS,
    })
    return {
      baseUrl,
      async read(key: string, signal = streamer.signal, priority?: number) {
        const [codec, bytes] = await Promise.all([
          families.pageCodec.load(),
          streamer.readBytes(key, signal, priority),
        ])
        codec.checkGeometryPage(loadedSdkWasm(), bytes)
        return bytes
      },
      dispose: streamer.dispose,
    }
  },
  /**
   * Describes how a model's pages are fetched: from which source, by how many workers.
   * @param p - The page source, and how many workers fetch at once.
   */
  createStreamer: (p: { source: WorldPageSource; workers?: number }): PageStreamer => ({
    source: p.source,
    workers: p.workers ?? DEFAULT_PAGE_WORKERS,
  }),
  /**
   * A pool in GPU memory holding the pages the frame reads, filled from a page source.
   * @param device - The GPU device to allocate on.
   * @param source - Where pages are read.
   * @param options - Bytes per page, and how many slots.
   */
  createCache: createGpuPageCache,
  /**
   * Unpacks one compressed geometry page into triangles and vertices, once the decoder's chunk
   * has arrived (`FAMILY_LOAD_FAILED` when it cannot).
   * @param bytes - The compressed page.
   */
  decode: async (bytes: ArrayBuffer | Uint8Array) =>
    (await families.pageCodec.load()).decodeGeometryPage(
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    ),
}
