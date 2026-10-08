// Which runs a suite plays: the bench's one scene by default, at most `MAX_SCENES` ever. No option
// lifts the cap: a suite of more is refused before any run starts.
import { BENCH_SCENE } from './worldScenario.ts'

/** The most scenes one suite plays. A test of more is a test of the wrong thing. */
export const MAX_SCENES = 5

/** The default suite: the bench's one scene, flown by its scenario. */
const DEFAULT_RUNS = [`${BENCH_SCENE}:world`]

/** The words that named the sets this suite no longer has. */
const REMOVED = ['all', 'reference', 'priority']

/** The runs a suite's list names (`page[:scenario],…`), or the default; throws past the cap. */
export function suiteRuns(list?: string) {
  const runs = list ? list.split(',').filter(Boolean) : DEFAULT_RUNS
  const removed = runs.find((run) => REMOVED.includes(run))
  if (removed)
    throw new Error(
      `BENCH_SUITE: "${removed}" named a set of pages the suite no longer plays: one scene by default, or a list of at most ${MAX_SCENES}`,
    )
  if (runs.length > MAX_SCENES)
    throw new Error(`BENCH_SUITE: ${runs.length} scenes asked, at most ${MAX_SCENES} are played`)
  return runs
}
