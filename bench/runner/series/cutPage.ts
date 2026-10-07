// The selected set of a series, read INSIDE the page. Served under `/runner/` and imported by its
// URL like `witness/threeLights.ts`: `measureView` is serialised by Playwright and cannot call any module
// function, but a URL `import()` remains open to it.

/**
 * The selected cut, read without any API added for the measurement: the engine publishes
 * `selectedPageIds()`. An engine of another id reports no source and no page.
 */
import type * as SdkBrowser from '../../witnesses/measurement.ts'
import type { CutSelection } from '../report/types.ts'

export function lireCoupe(
  explorer: Awaited<ReturnType<typeof SdkBrowser.openMeasuredWorld>>,
  engineId: string,
): CutSelection {
  const backend = explorer.engine as SdkBrowser.Engine
  if (backend.id === engineId)
    return { source: 'selectedPageIds', ids: [...backend.selectedPageIds()].sort() }
  return { source: null, ids: [] }
}
