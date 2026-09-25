import { readPath } from './contract.ts';
import type { ReportRecord } from './types.ts';

/** Domain groups stay explicit: these counters are not interchangeable memory totals. Each group
 *  and field is named by `report.diagnostics.<id>`; a field is `[id, path, unit]`. */
export const DIAGNOSTICS = [
  {
    id: 'shadows',
    fields: [
      ['shadowPagesRedrawn', 'stage:shadows:pagesRedessinees', ''],
      ['shadowPagesPending', 'stage:shadows:pagesEnAttente', ''],
      ['shadowDelay', 'stage:shadows:retardMaxMs', 'ms'],
      ['probesUpdated', 'stage:bounce:sondesMisesAJour', ''],
      ['raysPerFrame', 'stage:bounce:rayonsParImage', ''],
    ],
  },
  {
    id: 'residency',
    fields: [
      ['residentPages', 'budgetPages.residentes', ''],
      ['requestedPages', 'budgetPages.demande', ''],
      ['texturesPending', 'metrics.texturePending', ''],
      ['texturesEvicted', 'metrics.textureEvictions', ''],
      ['gpuAllocations', 'metrics.gpuAllocatedBytes', 'bytes'],
    ],
  },
  {
    id: 'lighting',
    fields: [
      ['lightsActive', 'metrics.lightsActive', ''],
      ['trianglesSubmitted', 'totalSubmittedTriangles', ''],
      ['opaqueTrianglesSubmitted', 'submittedTriangles', ''],
      ['trianglesOccluded', 'metrics.hizRejectedTriangles', ''],
      ['pagesDecodedWasm', 'metrics.pagesDecodedWasm', ''],
    ],
  },
] as const;

export function diagnosticValue(record: ReportRecord | null | undefined, path: string) {
  if (path.startsWith('stage:')) {
    const [, stage, key] = path.split(':');
    const value = record?.data.profilParEtape?.stages?.find((item) => item.stage === stage)
      ?.counts?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  const value = readPath(record?.data, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
