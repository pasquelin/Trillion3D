import { maxStretch } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { projectedClusterError } from './pageSelectionMath.ts';
import type { PageRec } from './pageSelectionTypes.ts';

const diagnosticErrorView = new THREE.Matrix4();

/** Use the cut's screen-error projection for a displayed page. */
export function projectedPageError(
  rec: Pick<PageRec, 'lodError' | 'sphere' | 'matrix'>,
  camera: THREE.PerspectiveCamera,
  viewport: readonly [number, number],
) {
  if ((rec.lodError ?? 0) === 0) return 0;
  camera.updateMatrixWorld();
  const view = diagnosticErrorView.multiplyMatrices(camera.matrixWorldInverse, rec.matrix);
  const stretch = maxStretch(rec.matrix.elements) * maxStretch(camera.matrixWorldInverse.elements);
  const focal =
    Math.max(
      viewport[0] * Math.abs(camera.projectionMatrix.elements[0]),
      viewport[1] * Math.abs(camera.projectionMatrix.elements[5]),
    ) / 2;
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
