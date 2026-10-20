import { createHostRankDelta } from './hostRanks.ts'
import type { HostRetentionDelta } from './types.ts'

/** The pages a frame keeps, told to a streamer the way the engine tells them: as the rank delta
 *  from the last list to `held`, the ranks those of `urls`. */
export function retained(
  streamer: { retainRanks(delta: HostRetentionDelta): unknown },
  urls: readonly string[],
) {
  const ranks = createHostRankDelta(urls.length, urls)
  return (held: readonly string[]) => {
    ranks.begin()
    for (const url of held) ranks.markRank(urls.indexOf(url))
    streamer.retainRanks(ranks.finish())
  }
}
