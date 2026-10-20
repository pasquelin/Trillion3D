import type { DiagnosticMode } from '../../../../sdk-core/src/runtime/diagnostics.ts'
import { pageDiagnosticWord } from '../../page/selection/diagnostic.ts'
import { clusterHash } from '../../visibility/math.ts'
import { diagnosticReads } from '../../visibility/shader/shadeMode.ts'
import { createPageCatalogue, type PageList } from '../../page/selection/catalogue.ts'
import type { WebgpuBlendState } from './state.ts'

/**
 * The cluster word every transparent instance colours itself with, one per catalogue entry: the
 * cluster's hash, or its diagnostic word (`pageDiagnosticWord`), as the view drawn reads
 * (`diagnosticReads`). Both are properties of the cluster, not of the camera: the shader derives
 * the rest (`diagnosticColor`), the screen error included. So the table is written whole when the
 * mode changes, never per image, and never at all in beauty or a view that reads neither.
 */
export function writeBlendDiagnostic(
  blendState: WebgpuBlendState,
  packedPages: PageList,
  diagnostic: DiagnosticMode,
) {
  const { table, compaction } = blendState
  if (!table || !compaction) return
  const reads = diagnosticReads(diagnostic)
  if (!reads || blendState.diagnosticMode === diagnostic) return
  // The accessor is built after the guards: an image that reads no cluster word allocates nothing.
  const { recordOf } = createPageCatalogue(packedPages)
  blendState.diagnosticMode = diagnostic
  if (blendState.clusterIdentity.length < table.capacity)
    blendState.clusterIdentity = new Uint32Array(table.capacity)
  const identity = blendState.clusterIdentity
  for (let entry = 0; entry < table.capacity; entry++) {
    const page = table.pageOfEntry[entry]
    if (page < 0) {
      identity[entry] = 0
      continue
    }
    const rec = recordOf(page)!
    identity[entry] = reads === 'hash' ? clusterHash(rec.clusterId) : pageDiagnosticWord(rec)
  }
  compaction.uploadDiagnostic(identity.subarray(0, table.capacity))
}
