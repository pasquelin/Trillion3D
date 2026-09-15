import type * as THREE from 'three';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { projectedPageError, type PageRec } from './pageSelection.ts';
import { screenErrorRatio } from './diagnosticColors.ts';
import { clusterHash } from './visibilityBuffer.ts';
import type { createWebgpuBlendState } from './webgpuBlendState.ts';

type BlendState = ReturnType<typeof createWebgpuBlendState>;

/**
 * The cluster identity every transparent instance colours itself with, one word per catalogue entry.
 *
 * It is a property of the cluster, not of the cut: the hash and the level never move, and only
 * `screen-error` depends on the camera. So the table is written whole when the mode changes and
 * re-written per image only for that one mode — and never at all in beauty.
 */
export function writeBlendDiagnostic(
  blendState: BlendState,
  packedPages: readonly PageRec[],
  diagnostic: DiagnosticMode,
  lastCamera: THREE.PerspectiveCamera | undefined,
  viewport: readonly [number, number],
  diagnosticPixelError: number,
) {
  const { table, compaction } = blendState;
  if (!table || !compaction) return;
  if (diagnostic !== 'clusters' && diagnostic !== 'lod' && diagnostic !== 'screen-error') return;
  if (blendState.diagnosticMode === diagnostic && diagnostic !== 'screen-error') return;
  blendState.diagnosticMode = diagnostic;
  if (blendState.clusterIdentity.length < table.capacity)
    blendState.clusterIdentity = new Uint32Array(table.capacity);
  const identity = blendState.clusterIdentity;
  for (let entry = 0; entry < table.capacity; entry++) {
    const page = table.pageOfEntry[entry];
    if (page < 0) {
      identity[entry] = 0;
      continue;
    }
    const rec = packedPages[page],
      hash = clusterHash(rec.clusterId) & 0x00ffffff;
    const ratio =
      diagnostic === 'screen-error' && lastCamera
        ? Math.round(
            screenErrorRatio(projectedPageError(rec, lastCamera, viewport), diagnosticPixelError) *
              127,
          )
        : 0;
    identity[entry] = (hash | (ratio << 24) | (rec.role === 'coarse' ? 0x80000000 : 0)) >>> 0;
  }
  compaction.uploadDiagnostic(identity.subarray(0, table.capacity));
}
