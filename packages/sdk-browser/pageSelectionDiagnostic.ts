import { maxStretch } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { projectedClusterError } from './pageSelectionMath.ts';
import type { PageRec } from './pageSelectionTypes.ts';
import { pixelScaleOf } from './streamingPriority.ts';
import { resolveCameraWorld } from './cameraWorld.ts';

const diagnosticErrorView = new THREE.Matrix4();
const diagnosticPixelScale = [1, 1];

/** Use the cut's screen-error projection for a displayed page. */
export function projectedPageError(
  rec: Pick<PageRec, 'lodError' | 'sphere' | 'matrix'>,
  camera: THREE.PerspectiveCamera,
  viewport: readonly [number, number],
) {
  if ((rec.lodError ?? 0) === 0) return 0;
  // Fonction appelable seule : elle résout sa propre pose (contrat : `cameraWorld.ts`).
  resolveCameraWorld(camera);
  const view = diagnosticErrorView.multiplyMatrices(camera.matrixWorldInverse, rec.matrix);
  const stretch = maxStretch(rec.matrix.elements) * maxStretch(camera.matrixWorldInverse.elements);
  const scale = pixelScaleOf(camera, viewport, diagnosticPixelScale);
  const focal = Math.max(scale[0], scale[1]);
  return projectedClusterError(
    rec.lodError,
    rec.sphere,
    0,
    view.elements,
    stretch,
    focal,
    camera.near,
  );
}
