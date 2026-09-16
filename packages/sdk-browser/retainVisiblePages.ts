import type { RenderBackend } from './backendTypes.ts';
import type { createPageStreamer } from './streamingPages.ts';

/**
 * Les épingles par différence de rangs quand le moteur sait les dire : l'hôte ne refait plus un
 * ensemble de chaînes par image. Le repli WebGL, qui ne la porte pas, garde la liste d'adresses.
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
