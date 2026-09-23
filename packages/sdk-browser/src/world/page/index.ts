import type { PageSource } from '../../../../sdk-core/src/index.ts';
import { createGpuPageCache, httpPageSource } from '../../gpu/page/pages.ts';
import { decodeGeometryPage } from '../../page/decode/geometryPage.ts';
import { DEFAULT_PAGE_WORKERS } from '../../backend/common.ts';

/** Where pages are read from, and the address they are read against. */
export type WorldPageSource = PageSource & {
  /** The address every page is read against. */
  readonly baseUrl: string;
};

/** How a model's pages are fetched: from which source, by how many workers at once. */
export interface PageStreamer {
  /** Where the pages are read from. */
  readonly source: WorldPageSource;
  /** How many workers fetch and decode pages at once. */
  readonly workers: number;
}

/**
 * The `page` family: geometry cut into pages, which enter and leave memory by what the frame
 * reads. `createCache` is the GPU page pool (`createGpuPageCache`), `decode` the cluster page
 * decoder (`decodeGeometryPage`).
 */
export const page = {
  /**
   * A page source that reads pages over HTTP from `baseUrl`.
   * @param baseUrl - The address pages are read against.
   */
  httpSource: (baseUrl: string): WorldPageSource => ({ ...httpPageSource(baseUrl), baseUrl }),
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
   * Unpacks one compressed geometry page into triangles and vertices.
   * @param bytes - The compressed page.
   */
  decode: (bytes: ArrayBuffer | Uint8Array) =>
    decodeGeometryPage(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
};
