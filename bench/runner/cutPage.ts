// The selected set of a series, read INSIDE the page. Served under `/runner/` and imported by its
// URL like `witnessPage.ts`: `measureView` is serialised by Playwright and cannot call any module
// function, but a URL `import()` remains open to it.

/**
 * The selected cut, read without any API added for the measurement. WebGPU publishes
 * `selectedPageIds()`; the WebGL path has no equivalent, but outside beauty mode it attaches a
 * mesh per displayed page and stores its `clusterId` there. Mode `pages` and not `clusters`:
 * `clusters` tints each page with its colour, hence one shader per cluster — 80 153 read once
 * on a ten-million-triangle interior,
 * enough to exhaust the driver — while `pages` has only two and renders the same meshes. The two
 * sources are not compared; the report says which one served.
 */
import type * as SdkBrowser from '../witnesses/measurement.ts';
import type { Coupe } from './report/types.ts';

type Backend = SdkBrowser.RenderBackend & { selectedPageIds?: () => Iterable<string> };

export function lireCoupe(
  explorer: Awaited<ReturnType<typeof SdkBrowser.openMeasuredWorld>>,
  engineId: string,
): Coupe {
  const backend = explorer.backends.find((candidate) => candidate.id === engineId) as
    Backend | undefined;
  if (backend && typeof backend.selectedPageIds === 'function')
    return { source: 'selectedPageIds', ids: [...backend.selectedPageIds()].sort() };
  if (!backend || !backend.scene) return { source: null, ids: [] };
  explorer.setDiagnostic('pages');
  const ids = (backend.scene.children as readonly { userData?: { clusterId?: unknown } }[])
    .map((child) => child.userData && child.userData.clusterId)
    .filter((id): id is string => typeof id === 'string')
    .sort();
  explorer.setDiagnostic('beauty');
  return { source: 'clusterId', ids };
}
