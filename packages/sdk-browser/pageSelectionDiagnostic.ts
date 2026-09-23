import { maxStretch, multiplyMatrix4 } from '../sdk-core/src/index.ts';
import { projectedClusterError } from './pageSelectionMath.ts';
import type { PageRec } from './pageSelectionTypes.ts';
import { copyElements } from './matrixElements.ts';
import { pixelScaleOf } from './streamingPriority.ts';
import type { EngineCamera } from './cameraWorld.ts';

const diagnosticErrorView = new Float64Array(16);
/** Host pose copied: the core product only reads `Float64Array`. */
const diagnosticWorld = new Float64Array(16);
const diagnosticPixelScale = [1, 1];

/** Use the cut's screen-error projection for a displayed page. */
export function projectedPageError(
  rec: Pick<PageRec, 'lodError' | 'sphere' | 'matrix'>,
  cam: EngineCamera,
  viewport: readonly [number, number],
) {
  if ((rec.lodError ?? 0) === 0) return 0;
  copyElements(diagnosticWorld, rec.matrix.elements);
  const view = multiplyMatrix4(diagnosticErrorView, cam.view, diagnosticWorld);
  const stretch = maxStretch(rec.matrix.elements) * maxStretch(cam.view);
  const scale = pixelScaleOf(cam.projection, viewport, diagnosticPixelScale);
  const focal = Math.max(scale[0], scale[1]);
  const { near, perspective } = cam;
  return projectedClusterError(
    rec.lodError,
    rec.sphere,
    0,
    view,
    stretch,
    focal,
    near,
    perspective,
  );
}
