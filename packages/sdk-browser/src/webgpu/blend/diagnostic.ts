import type { EngineCamera } from '../../camera/world.ts'
import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts'
import {
  projectedPageError,
  rootOf,
  type ClusterRoot,
  type PageRec,
} from '../../page/selection/selection.ts'
import { screenErrorRatio } from '../../diagnostic/colors.ts'
import { clusterHash } from '../../visibility/buffer.ts'
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts'
import type { createWebgpuBlendState } from './state.ts'

type BlendState = ReturnType<typeof createWebgpuBlendState>

/**
 * The cluster identity every transparent instance colours itself with, one word per catalogue entry.
 *
 * It is a property of the cluster, not of the cut: the hash and the level never move, and only
 * `screen-error` depends on the camera. So the table is written whole when the mode changes and
 * re-written per image only for that one mode — and never at all in beauty.
 */
export function writeBlendDiagnostic(
  blendState: BlendState,
  packedPages: PageList,
  roots: readonly ClusterRoot<PageRec>[],
  rootOfPacked: Int32Array,
  diagnostic: DiagnosticMode,
  cam: EngineCamera | undefined,
  viewport: readonly [number, number],
  diagnosticPixelError: number,
) {
  const { table, compaction } = blendState
  if (!table || !compaction) return
  // The accessor is built after the guards: a beauty image, which reads no diagnostic, allocates
  // nothing here.
  if (diagnostic !== 'clusters' && diagnostic !== 'lod' && diagnostic !== 'screen-error') return
  if (blendState.diagnosticMode === diagnostic && diagnostic !== 'screen-error') return
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
    const rec = recordOf(page)!,
      hash = clusterHash(rec.clusterId) & 0x00ffffff
    const ratio =
      diagnostic === 'screen-error' && cam
        ? Math.round(
            screenErrorRatio(
              projectedPageError(rec, rootOf(roots, rootOfPacked[page]).world, cam, viewport),
              diagnosticPixelError,
            ) * 127,
          )
        : 0
    identity[entry] = (hash | (ratio << 24) | (rec.role === 'coarse' ? 0x80000000 : 0)) >>> 0
  }
  compaction.uploadDiagnostic(identity.subarray(0, table.capacity))
}
