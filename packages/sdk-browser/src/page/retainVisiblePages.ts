import type { RenderBackend } from '../backend/types.ts';
import type { createPageStreamer } from '../streaming/pages.ts';

/**
 * Pinning by rank difference when engine supports it: host no longer reconstructs
 * a set of strings per frame. WebGL fallback, which does not support it, keeps list of URLs.
 */
export function retainVisiblePages(
  backend: RenderBackend,
  streamer: ReturnType<typeof createPageStreamer>,
) {
  const ranks = backend.retainedRanks?.();
  if (ranks) streamer.retainRanks(ranks);
  else {
    const urls = backend.pageUrls?.();
    if (urls) streamer.retain(urls);
  }
}
