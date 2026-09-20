import type { PageRec } from './pageSelection.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { ClusterBatches } from './clusterBatches.ts';

export function createExactPagesResidency(
  shown: PageRec[],
  desired: PageRec[],
  attached: PageRec[],
  batches: ClusterBatches,
  release: (rec: PageRec) => void,
  attach: (rec: PageRec, addToScene?: boolean) => void,
  getDiagnostic: () => DiagnosticMode,
  counters: { pagesDetached: number; displayDetachments: number },
) {
  const diagnosticMeshes: import('three').Mesh[] = [];
  const displayList = () => (shown.length ? shown : desired);
  const syncResident = () => {
    const display = displayList();
    const diagnostic = getDiagnostic();
    diagnosticMeshes.length = 0;
    // The cut is walked once: marking resident pages, counting exits, rebuilding
    // the displayed-page list. No scan of the scene's whole page set.
    for (let i = 0; i < display.length; i++) if (display[i].array) display[i].resident = true;
    for (let i = 0; i < attached.length; i++) {
      const rec = attached[i];
      if (rec.resident) continue;
      if (rec.attached) {
        release(rec);
        counters.displayDetachments++;
      }
      counters.pagesDetached++;
    }
    attached.length = 0;
    for (let i = 0; i < display.length; i++) {
      const rec = display[i];
      if (!rec.array) continue;
      rec.resident = false;
      attached.push(rec);
      if (diagnostic === 'beauty') {
        if (rec.attached) release(rec);
      } else {
        attach(rec, !batches.autonomousDraw);
        if (batches.autonomousDraw && rec.mesh) diagnosticMeshes.push(rec.mesh);
      }
    }
    batches.setDiagnosticMeshes(diagnosticMeshes);
    if (diagnostic === 'beauty') batches.update(display);
    else batches.hideAll();
  };
  return syncResident;
}
