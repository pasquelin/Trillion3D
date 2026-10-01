import {
  clipPlanesFromMatrix,
  frustumClipBox,
  frustumFarPlane,
  maxStretch,
  multiplyMatrix4,
} from '../../../../sdk-core/src/index.ts';
import { frameParametersSound } from '../../../../sdk-core/src/lod/screenErrorBound.ts';
import type { EngineCamera } from '../../camera/world.ts';
import { pixelScaleOf } from '../../streaming/priority.ts';
import type { ClusterRoot } from '../selection/types.ts';
import { copyElements } from '../../math/matrixElements.ts';
import { worldStretch } from './logic.ts';
import { OPEN_PLANES, openMark } from './openRoot.ts';

/** Several lenses constrain one DAG cut: visibility is their union, error their maximum. */
export interface CutView {
  camera: EngineCamera;
  viewport: [number, number];
}
export interface CutLens {
  camera: EngineCamera;
  matrix: Float64Array;
  planes: Float64Array;
  stretch: number;
  focal: number;
  sound: boolean;
}
const lenses: CutLens[] = [];
const rootMatrix = new Float64Array(16),
  projection = new Float64Array(16),
  scale: [number, number] = [1, 1];
/** Reused per-root lens data; selection is synchronous, like the existing selection scratch. */
export function prepareCutViews<T>(
  views: readonly CutView[],
  root: ClusterRoot<T>,
): readonly CutLens[] {
  lenses.length = views.length;
  copyElements(rootMatrix, root.world.elements);
  for (let i = 0; i < views.length; i++) {
    const { camera, viewport } = views[i];
    const lens =
      lenses[i] ??
      (lenses[i] = {
        camera,
        matrix: new Float64Array(16),
        planes: new Float64Array(24),
        stretch: 1,
        focal: 1,
        sound: false,
      });
    lens.camera = camera;
    multiplyMatrix4(lens.matrix, camera.view, rootMatrix);
    clipPlanesFromMatrix(lens.planes, multiplyMatrix4(projection, camera.projection, lens.matrix));
    frustumFarPlane(lens.planes, 16, lens.matrix, camera.far, false);
    if (openMark(root.mark, undefined)) lens.planes.set(OPEN_PLANES);
    else if ((root.reach ?? 0) > 0)
      for (let p = 0; p < 24; p += 4)
        lens.planes[p + 3] +=
          root.reach! *
          (Math.abs(lens.planes[p]) + Math.abs(lens.planes[p + 1]) + Math.abs(lens.planes[p + 2]));
    pixelScaleOf(camera.projection, viewport, scale);
    lens.focal = Math.max(scale[0], scale[1]);
    lens.stretch = worldStretch(root) * maxStretch(camera.view);
    lens.sound = frameParametersSound(lens.stretch, lens.focal, camera.near, camera.perspective);
  }
  return lenses;
}
/** Entirely inside one lens is inside the union; outside means every lens rejected it. */
export function clipCutViews(
  lenses: readonly CutLens[] | undefined,
  planes: Float64Array,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
) {
  if (!lenses) return frustumClipBox(planes, x0, y0, z0, x1, y1, z1);
  let result = 0;
  for (const lens of lenses)
    result = Math.max(result, frustumClipBox(lens.planes, x0, y0, z0, x1, y1, z1));
  return result;
}
