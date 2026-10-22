import { defineModule, type ModuleState } from '../descriptor.ts'
import { STATS_TABS } from './counters.ts'
import type { StatsParts } from './report.ts'

/** The parts of the stats module: each tab's numbers, then the panel. */
const STATS_PART_NAMES = [...STATS_TABS, 'panel'] as const

/** The stats module: the profiler overlay and the report behind it. Off unless a source switches it
 *  on; each tab's numbers and the panel are parts, each switched alone. */
export const STATS_MODULE = defineModule({
  name: 'stats',
  enabledByDefault: false,
  requires: [],
  parts: STATS_PART_NAMES,
})

/** Which parts of the stats module run, from the merged parts of its state: a part the state does
 *  not name is on, `false` is off. */
export function statsParts(state: ModuleState['parts'] | undefined): StatsParts {
  const on = (part: string) => state?.[part] !== false
  return Object.fromEntries(STATS_PART_NAMES.map((part) => [part, on(part)])) as StatsParts
}
