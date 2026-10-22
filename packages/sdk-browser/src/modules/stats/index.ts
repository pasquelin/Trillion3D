import type { StatsReport, StatsParts } from '../../../../sdk-core/src/modules/stats/report.ts'
import type { StatsWords } from '../../../../sdk-core/src/modules/stats/words.ts'
import type { StatsCorner } from './panel/layout.ts'
import { collectStats, type StatsSource } from './collect.ts'

export type { StatsSource } from './collect.ts'
export type { StatsCorner } from './panel/layout.ts'

/** A running stats module. */
export interface StatsHandle {
  /** The report of the last second, built at most four times a second; `null` before a frame. */
  read(full?: boolean): StatsReport | null
  /** Takes off everything `startStats` put on: the frame hook, the panel and the CPU step window. A panel
   *  still loading is not mounted. */
  stop(): void
  /** Settles once the panel is mounted, at once without a panel; rejects when the panel failed to
   *  load, after the module has stopped. */
  ready: Promise<void>
}

/** Where the stats module starts and what it shows. */
export interface StatsOptions {
  /** Where the panel is mounted; without it no panel is made, whatever `parts.panel` says. */
  parent?: HTMLElement
  /** The parts switched on (`statsParts`). */
  parts: StatsParts
  /** The corner the panel starts in. */
  corner?: StatsCorner
  /** The page's translations of the panel's labels and hints. */
  words?: StatsWords
  /** The page's live worlds, the watched one among them (the first made is the main view): with
   *  others, or views beside the main one, the report gets an `All worlds` section, and the panel
   *  tags the watched world's place. */
  worlds?: () => readonly StatsSource[]
}

/**
 * Starts the stats module on `world`: collects its frames, and shows the panel in `parent` when the
 * `panel` part is on (loaded in the background, not before). The `cpu` part reads a CPU step window
 * of its own (`openCpuSteps`), open only while full reports are read, which has the engine file its
 * rows without the page's debug mode. The handle is returned at once; `ready` settles with the panel.
 */
export function startStats(world: StatsSource, options: StatsOptions): StatsHandle {
  const { parts } = options
  const collector = collectStats(world, parts, options.worlds)
  let panel: { stop(): void } | null = null,
    stopped = false
  const stop = () => {
    stopped = true
    panel?.stop()
    collector.stop()
  }
  const { parent } = options
  const ready =
    parts.panel && parent
      ? import('./panel/panel.ts')
          .then(({ statsPanel }) => {
            if (stopped) return
            panel = statsPanel(parent, collector.report, {
              corner: options.corner ?? 'bottom-left',
              words: options.words,
            })
          })
          .catch((error) => {
            stop()
            throw error
          })
      : Promise.resolve()
  return { read: collector.report, stop, ready }
}
