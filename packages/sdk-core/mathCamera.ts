import { FRUSTUM_PLANE_VALUES, frustumPlanesFromMatrix } from './mathFrustum.ts';
import { multiplyMatrix4, type NumberSink } from './mathMatrix4.ts';
import { invertMatrix4 } from './mathMatrix4Inverse.ts';

/**
 * Caméra du moteur : projections perspective et orthographique dans les deux conventions de
 * profondeur de découpe — `[-1, 1]` (WebGL, `depthZeroToOne` faux) et `[0, 1]` (WebGPU) — et matrices
 * d'une image : vue, vue-projection, plans du tronc. La pose de la caméra est un nœud de la hiérarchie
 * de transformations ; sa matrice monde entre ici.
 *
 * Formules de `updateProjectionMatrix` de la référence, puis de `makePerspective` et
 * `makeOrthographic`, terme à terme : les mêmes bits. Ni vue décalée (`setViewOffset`) ni décalage de
 * film : le moteur n'en pose aucun.
 */

const DEG2RAD = Math.PI / 180;

/**
 * Projection perspective d'une caméra de champ vertical `fov` degrés, rapport `aspect`, plans `near`
 * et `far`, grossissement `zoom`.
 */
export function perspectiveProjection<T extends NumberSink>(
  out: T,
  fov: number,
  aspect: number,
  near: number,
  far: number,
  zoom: number,
  depthZeroToOne: boolean,
) {
  const top = (near * Math.tan(DEG2RAD * 0.5 * fov)) / zoom;
  const height = 2 * top,
    width = aspect * height;
  const left = -0.5 * width,
    right = left + width,
    bottom = top - height;
  const c = depthZeroToOne ? -far / (far - near) : -(far + near) / (far - near);
  const d = depthZeroToOne ? (-far * near) / (far - near) : (-2 * far * near) / (far - near);
  out[0] = (2 * near) / (right - left);
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = (2 * near) / (top - bottom);
  out[6] = 0;
  out[7] = 0;
  out[8] = (right + left) / (right - left);
  out[9] = (top + bottom) / (top - bottom);
  out[10] = c;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = d;
  out[15] = 0;
  return out;
}

/** Projection orthographique d'une boîte de vue `left`…`bottom`, `near`, `far`, centrée puis zoomée. */
export function orthographicProjection<T extends NumberSink>(
  out: T,
  left: number,
  right: number,
  top: number,
  bottom: number,
  near: number,
  far: number,
  zoom: number,
  depthZeroToOne: boolean,
) {
  const dx = (right - left) / (2 * zoom),
    dy = (top - bottom) / (2 * zoom);
  const cx = (right + left) / 2,
    cy = (top + bottom) / 2;
  const l = cx - dx,
    r = cx + dx,
    t = cy + dy,
    b = cy - dy;
  const w = 1.0 / (r - l),
    h = 1.0 / (t - b),
    p = 1.0 / (far - near);
  out[0] = 2 * w;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = 2 * h;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = depthZeroToOne ? -1 * p : -2 * p;
  out[11] = 0;
  out[12] = -((r + l) * w);
  out[13] = -((t + b) * h);
  out[14] = -(depthZeroToOne ? near * p : (far + near) * p);
  out[15] = 1;
  return out;
}

/** Les matrices d'une image de caméra, allouées une fois et réécrites à chaque image. */
export interface CameraFrame {
  /** Vue : l'inverse de la matrice monde de la caméra (`matrixWorldInverse`). */
  view: Float64Array;
  /** Projection × vue. */
  viewProjection: Float64Array;
  /** Les six plans normalisés du tronc de `viewProjection`, rangés comme `frustumPlanesFromMatrix`. */
  planes: Float64Array;
}

export function createCameraFrame(): CameraFrame {
  return {
    view: new Float64Array(16),
    viewProjection: new Float64Array(16),
    planes: new Float64Array(FRUSTUM_PLANE_VALUES),
  };
}

/**
 * Réécrit l'image : vue = inverse de `world` (nulle pour une matrice monde singulière, comme la
 * référence), vue-projection = `projection · vue`, plans du tronc dans la convention
 * `planesDepthZeroToOne` — celle que lit le consommateur, pas forcément celle de la projection.
 */
export function updateCameraFrame(
  frame: CameraFrame,
  projection: ArrayLike<number>,
  world: ArrayLike<number>,
  planesDepthZeroToOne: boolean,
) {
  invertMatrix4(frame.view, world);
  multiplyMatrix4(frame.viewProjection, projection, frame.view);
  frustumPlanesFromMatrix(frame.planes, frame.viewProjection, planesDepthZeroToOne);
  return frame;
}
