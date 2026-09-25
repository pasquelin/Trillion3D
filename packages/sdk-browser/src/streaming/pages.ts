import type { BackendDiagnostic } from '../backend/types.ts';
import type { StreamPage } from './types.ts';
import { DEFAULT_CACHED_BYTES } from './pageCache.ts';
import { createPageStreamerWith } from './pageStreamer.ts';
export type { StreamPage } from './types.ts';
/** Bounded, prioritized and deduplicated reads. A request still waiting in the queue is dropped once
 *  its last consumer leaves; one already transferring is allowed to land in the cache.
 *  The cache is a least-recently-used set bounded by both entries and bytes; pinned entries survive
 *  eviction, so a caller keeps its displayed cover by retaining it. */
export function createPageStreamer(
  pages: readonly StreamPage[],
  base: string,
  signal?: AbortSignal,
  workerCount = 8,
  maxPages?: number,
  onEvict?: (url: string) => void,
  maxTransferBytes = 8 * 1024 * 1024,
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void,
  maxCachedBytes = DEFAULT_CACHED_BYTES,
) {
  return createPageStreamerWith(
    undefined,
    pages,
    base,
    signal,
    workerCount,
    maxPages,
    onEvict,
    maxTransferBytes,
    onDiagnostic,
    maxCachedBytes,
  );
}
