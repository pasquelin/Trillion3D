import { FRUSTUM_PLANE_VALUES, frustumPlanesFromMatrix } from './mathFrustum.ts';
import { multiplyMatrix4, type NumberSink } from './mathMatrix4.ts';
import { invertMatrix4 } from './mathMatrix4Inverse.ts';

/**
 * Caméra perspective du moteur, en PROFONDEUR INVERSÉE et plan lointain infini : le plan proche se
 * projette sur 1, l'infini sur 0, et la découpe reste `[0, 1]`. C'est la convention unique du
 * moteur, celle que `depthConvention.ts` (sdk-browser) publie aux pipelines et aux lecteurs de
 * profondeur ; aucune autre n'est portée ici.
 *
 * POURQUOI. Une profondeur en simple précision concentre ses bits près de zéro, et la division
 * perspective concentre déjà la profondeur près du plan proche : les deux effets s'annulent quand
 * le plan proche vaut 1 et le lointain 0, si bien qu'à mille kilomètres deux surfaces voisines
 * gardent encore des profondeurs distinctes là où la convention directe les écrasait sur la même
 * valeur. Le plan lointain n'entre plus dans la formule — plus de `far - near` au dénominateur,
 * donc plus rien à régler et rien qui sature : `ndc = near / distance`.
 *
 * Ni vue décalée (`setViewOffset`), ni décalage de film, ni projection orthographique : le moteur
 * n'en pose aucune.
 */

const DEG2RAD = Math.PI / 180;

/**
 * Projection perspective d'une caméra de champ vertical `fov` degrés, rapport `aspect`, plan proche
 * `near`, grossissement `zoom`. Profondeur inversée, plan lointain infini : `near` se projette sur
 * 1, l'infini sur 0. Aucun plan lointain n'entre ici, donc aucune division par lui.
 */
export function perspectiveProjection<T extends NumberSink>(
  out: T,
  fov: number,
  aspect: number,
  near: number,
  zoom: number,
) {
  const top = (near * Math.tan(DEG2RAD * 0.5 * fov)) / zoom;
  const height = 2 * top,
    width = aspect * height;
  const left = -0.5 * width,
    right = left + width,
    bottom = top - height;
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
  // `z_découpe = near` et `w_découpe = -z_vue` : la profondeur normalisée vaut `near / distance`,
  // qui vaut 1 au plan proche et tend vers 0 sans jamais l'atteindre.
  out[10] = 0;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = near;
  out[15] = 0;
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
 * référence), vue-projection = `projection · vue`, et les six plans du tronc de cette
 * vue-projection. Une seule convention de profondeur traverse les trois.
 */
export function updateCameraFrame(
  frame: CameraFrame,
  projection: ArrayLike<number>,
  world: ArrayLike<number>,
) {
  invertMatrix4(frame.view, world);
  multiplyMatrix4(frame.viewProjection, projection, frame.view);
  frustumPlanesFromMatrix(frame.planes, frame.viewProjection);
  return frame;
}
