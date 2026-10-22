import type { StatsWorldFigures } from '../../../../sdk-core/src/modules/stats/report.ts'
import type { StatsSource } from './collect.ts'
import { frameSeries } from './frameSeries.ts'
import { unprofiledOnFrame } from './profile.ts'

/** One other world watched lightly: the frames it drew over the last second (`frameSeries`). */
function watchWorld(world: StatsSource) {
  const series = frameSeries()
  const unhook = unprofiledOnFrame(world)(({ metrics }) => series.push(metrics, performance.now()))
  return {
    stop: unhook,
    figures(now: number): StatsWorldFigures {
      series.trim(now)
      return series.figures()
    },
  }
}

/**
 * The page's other worlds than `main`, each watched lightly, only while someone reads: each `read`
 * brings the watches in line with `worlds()` (a world made since is watched, one gone is let go)
 * and hands back every other world's figures of the last second, in the list's order. `stop` lets
 * them all go; a later `read` watches again, so a panel that is folded or hidden costs the other
 * worlds nothing.
 */
export function watchWorlds(main: StatsSource, worlds: () => readonly StatsSource[]) {
  const watched = new Map<StatsSource, ReturnType<typeof watchWorld>>()
  const stop = () => {
    for (const watch of watched.values()) watch.stop()
    watched.clear()
  }
  return {
    read(now: number): StatsWorldFigures[] {
      const live = worlds().filter((world) => world !== main)
      for (const [world, watch] of watched)
        if (!live.includes(world)) {
          watch.stop()
          watched.delete(world)
        }
      for (const world of live) if (!watched.has(world)) watched.set(world, watchWorld(world))
      return live.map((world) => watched.get(world)!.figures(now))
    },
    stop,
  }
}
