import type * as THREE from 'three';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { projectedPageError } from './pageSelection.ts';
import { screenErrorRatio } from './diagnosticColors.ts';
import { clusterHash } from './visibilityBuffer.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

/** Updates per-triangle identities only when a transparent cut or diagnostic changes. */
export function writeBlendDiagnostic(
  device: GPUDevice,
  item: BlendGpuItem,
  diagnostic: DiagnosticMode,
  lastCamera: THREE.PerspectiveCamera | undefined,
  viewport: readonly [number, number],
  diagnosticPixelError: number,
) {
  if (diagnostic === 'clusters' || diagnostic === 'lod' || diagnostic === 'screen-error') {
    const triangleCount = Math.floor(item.count / 3),
      bytes = Math.max(4, triangleCount * 4);
    if (bytes > Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize))
      throw new Error('GPU_TRANSPARENT_DIAGNOSTIC_BUDGET');
    if (!item.diagnosticData || item.diagnosticData.length < triangleCount)
      item.diagnosticData = new Uint32Array(triangleCount);
    if (!item.diagnosticBuffer || item.diagnosticBuffer.size < bytes) {
      item.diagnosticBuffer?.destroy();
      item.diagnosticBuffer = device.createBuffer({
        label: 'WG transparent triangle identity',
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      item.group = undefined;
      item.diagnosticCut = undefined;
    }
    if (
      item.diagnosticCut !== item.cut ||
      item.diagnosticMode !== diagnostic ||
      diagnostic === 'screen-error'
    ) {
      let at = 0;
      if (item.cut) {
        for (const rec of item.cut) {
          const hash = clusterHash(rec.clusterId) & 0x00ffffff;
          const ratio =
            diagnostic === 'screen-error' && lastCamera
              ? Math.round(
                  screenErrorRatio(
                    projectedPageError(rec, lastCamera, viewport),
                    diagnosticPixelError,
                  ) * 127,
                )
              : 0;
          const encoded = (hash | (ratio << 24) | (rec.role === 'coarse' ? 0x80000000 : 0)) >>> 0;
          item.diagnosticData.fill(encoded, at, at + rec.triangles);
          at += rec.triangles;
        }
      } else item.diagnosticData.fill(0, 0, triangleCount);
      device.queue.writeBuffer(
        item.diagnosticBuffer,
        0,
        item.diagnosticData.subarray(0, triangleCount),
      );
      item.diagnosticCut = item.cut;
      item.diagnosticMode = diagnostic;
    }
  }
}
