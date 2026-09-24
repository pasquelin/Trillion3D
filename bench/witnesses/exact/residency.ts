import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type { DiagnosticMode } from '../../../packages/sdk-core/src/index.ts';
import { ClusterBatches } from './batches/batches.ts';
import {
  asWholeMesh,
  type WholeMesh,
} from '../../../packages/sdk-browser/src/cluster/batchMesh.ts';

export function createExactPagesResidency(
  shown: PageRec[],
  desired: PageRec[],
  attached: PageRec[],
  batches: ClusterBatches,
  attach: (rec: PageRec) => void,
  getDiagnostic: () => DiagnosticMode,
  counters: { pagesDetached: number },
) {
  const diagnosticMeshes: WholeMesh[] = [];
  const displayList = () => (shown.length ? shown : desired);
  const syncResident = () => {
    const display = displayList();
    const diagnostic = getDiagnostic();
    diagnosticMeshes.length = 0;
    // The cut is walked once: marking resident pages, counting exits, rebuilding
    // the displayed-page list. No scan of the scene's whole page set.
    for (let i = 0; i < display.length; i++) if (display[i].array) display[i].resident = true;
    for (let i = 0; i < attached.length; i++) if (!attached[i].resident) counters.pagesDetached++;
    attached.length = 0;
    for (let i = 0; i < display.length; i++) {
      const rec = display[i];
      if (!rec.array) continue;
      rec.resident = false;
      attached.push(rec);
      if (diagnostic !== 'beauty') {
        attach(rec);
        if (rec.mesh) diagnosticMeshes.push(asWholeMesh(rec.mesh));
      }
    }
    if (diagnostic === 'beauty') batches.update(display);
    else batches.showPages(diagnosticMeshes);
  };
  return syncResident;
}
