import type { PageSource } from '../../../sdk-core/src/index.ts';
import { createGpuPageCache, httpPageSource } from '../../gpuPages.ts';
import { decodeGeometryPage } from '../../geometryPage.ts';
import { DEFAULT_PAGE_WORKERS } from '../../backendCommon.ts';

/** Where pages are read from, and the address they are read against. */
export type WorldPageSource = PageSource & { readonly baseUrl: string };

/** How a model's pages are fetched: from which source, by how many workers at once. */
export interface PageStreamer {
  readonly source: WorldPageSource;
  readonly workers: number;
}

/**
 * The `page` family: geometry cut into pages, which enter and leave memory by what the frame
 * reads. `createCache` is the GPU page pool (`createGpuPageCache`), `decode` the cluster page
 * decoder (`decodeGeometryPage`).
 */
export const page = {
  httpSource: (baseUrl: string): WorldPageSource => ({ ...httpPageSource(baseUrl), baseUrl }),
  createStreamer: (p: { source: WorldPageSource; workers?: number }): PageStreamer => ({
    source: p.source,
    workers: p.workers ?? DEFAULT_PAGE_WORKERS,
  }),
  createCache: createGpuPageCache,
  decode: (bytes: ArrayBuffer | Uint8Array) =>
    decodeGeometryPage(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
};
