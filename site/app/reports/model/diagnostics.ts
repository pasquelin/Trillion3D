import { readPath } from './contract.ts'
import type { ReportRecord } from './types.ts'

/** Domain groups stay explicit: these counters are not interchangeable memory totals. Each group
 *  and field is named by `report.diagnostics.<id>`; a field is `[id, path, unit]`. */
export const DIAGNOSTICS = [
  {
    id: 'shadows',
    fields: [
      ['shadowPagesRedrawn', 'stage:shadows:pagesRedrawn', ''],
      ['shadowPagesPending', 'stage:shadows:pagesPending', ''],
      ['shadowDelay', 'stage:shadows:maxWaitMs', 'ms'],
      ['probesUpdated', 'stage:bounce:probesUpdated', ''],
      ['raysPerFrame', 'stage:bounce:raysPerFrame', ''],
    ],
  },
  {
    id: 'residency',
    fields: [
      ['residentPages', 'pageBudget.resident', ''],
      ['requestedPages', 'pageBudget.requested', ''],
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
] as const

export function diagnosticValue(record: ReportRecord | null | undefined, path: string) {
  if (path.startsWith('stage:')) {
    const [, stage, key] = path.split(':')
    const value = record?.data.stageProfile?.stages?.find((item) => item.stage === stage)?.counts?.[
      key
    ]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const value = readPath(record?.data, path)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
