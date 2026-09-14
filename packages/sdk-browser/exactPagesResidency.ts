import type { PageRec } from './pageSelection.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { ClusterBatches } from './clusterBatches.ts';

export function createExactPagesResidency(
  shown: PageRec[],
  desired: PageRec[],
  attached: PageRec[],
  batches: ClusterBatches,
  release: (rec: PageRec) => void,
  attach: (rec: PageRec) => void,
  getDiagnostic: () => DiagnosticMode,
  counters: { pagesDetached: number; displayDetachments: number },
) {
  const displayList = () => (shown.length ? shown : desired);
  const syncResident = () => {
    const display = displayList();
    const diagnostic = getDiagnostic();
    // La coupe est parcourue une fois : marquage des pages résidentes, comptage des sorties, reconstruction
    // de la liste des pages affichées. Aucun balayage de l'ensemble des pages de la scène.
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
      } else attach(rec);
    }
    if (diagnostic === 'beauty') batches.update(display);
    else batches.hideAll();
  };
  return syncResident;
}
