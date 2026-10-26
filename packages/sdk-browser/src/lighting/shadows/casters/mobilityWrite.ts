import { arriveRank, rankBits, type MobilityState } from './mobilityState.ts'
import { MOBILITY_SHADOWLESS, MOBILITY_WORLD_SPACE } from '../mobilityBits.ts'

/**
 * Writes the words of the placements that need it — every placement once on a new layout, else the
 * ones `touch`ed since (they started or stopped moving, casting or casting far, were parked or
 * taken, turned static) — and hands each run of words that changed to `push`, as one span. A word
 * `touch`ed with nothing changed is not pushed. `castFlags` says how a placement casts:
 * `MOBILITY_SHADOWLESS` where it casts no shadow — `castShadow = false`, hidden or parked —, which
 * every caster pass skips, `MOBILITY_FAR_SHADOW` where it casts far shadows (`castFarShadow`), which
 * a sun's far-shadow test never leaves out, and the others of `castFlagsOf`. `disableSq` gives the
 * square of the distance past which a placement's object stops evaluating its offset (0 for never),
 * written beside the word; a placement whose distance changed is pushed too. A placement that
 * arrives — new in the layout, or casting after it cast nothing — and is often moving starts moving
 * (`arriveRank`).
 */
export function writeRootWords(
  s: MobilityState,
  push: (first: number, count: number) => void,
  castFlags: (rank: number) => number,
  disableSq: (rank: number) => number = () => 0,
) {
  const placements = s.moving.length
  if (s.wholeWords) {
    s.wholeWords = false
    s.changed.clear()
    s.worldSpace = 0
    for (let rank = 0; rank < placements; rank++) {
      const cast = castFlags(rank)
      if (rank >= s.arrived) arriveRank(s, rank, cast)
      s.words[rank] = rankBits(s, rank, cast)
      s.disable[rank] = disableSq(rank)
      if (s.words[rank] & MOBILITY_WORLD_SPACE) s.worldSpace++
    }
    s.arrived = placements
    if (placements) push(0, placements)
    return
  }
  if (!s.changed.count) return
  const { count, pairs } = s.changed.runs()
  let first = -1,
    last = -2
  for (let run = 0; run < count; run++) {
    for (let rank = pairs[2 * run]; rank <= pairs[2 * run + 1]; rank++) {
      const cast = castFlags(rank),
        was = s.words[rank]
      if (was & MOBILITY_SHADOWLESS && !(cast & MOBILITY_SHADOWLESS)) arriveRank(s, rank, cast)
      const word = rankBits(s, rank, cast),
        disable = disableSq(rank)
      if (word === s.words[rank] && disable === s.disable[rank]) continue
      s.worldSpace += +((word & MOBILITY_WORLD_SPACE) !== 0) - +((was & MOBILITY_WORLD_SPACE) !== 0)
      s.words[rank] = word
      s.disable[rank] = disable
      if (rank !== last + 1) {
        if (first >= 0) push(first, last - first + 1)
        first = rank
      }
      last = rank
    }
  }
  if (first >= 0) push(first, last - first + 1)
  s.changed.clear()
}
