import { multiplyMatrix4 } from '../sdk-core/index.ts';

/**
 * LA CONVENTION DE PROFONDEUR DE L'HÔTE, APPLIQUÉE.
 *
 * LE FAIT. La profondeur de découpe d'une caméra hôte vaut `[−1, 1]` en convention WebGL et
 * `[0, 1]` en convention WebGPU. `cameraWorld.readCameraWorld` est le seul site qui la DÉCIDE : il
 * la lit sur la caméra hôte et la pose dans `EngineCamera.depthZeroToOne`, d'où elle vaut déjà pour
 * les six plans du tronc. Ce fichier est le seul qui la CONVERTIT, et tout ce qui rend une
 * profondeur en `[0, 1]` — la vue-projection que le GPU lit, les bornes Hi-Z, le raster de
 * visibilité — passe par ici. Sans cela, la moitié du moteur honorait la convention de l'hôte
 * pendant que l'autre moitié ramenait toujours `[−1, 1]` vers `[0, 1]`, et une caméra `[0, 1]`
 * repassait par une conversion déjà faite.
 *
 * CE QUI NE CHANGE PAS. Les abscisses et les ordonnées normalisées valent `[−1, 1]` dans les deux
 * conventions : leur passage à l'écran ne dépend de rien et reste là où il est. Pour une caméra
 * WebGL — celle que `createExplorerCamera` construit, celle du banc — chaque fonction d'ici rend
 * exactement les bits de l'arithmétique qu'elle remplace.
 */

/** Profondeur de découpe de −1 à 1 ramenée à 0 → 1, colonne-major. */
const remapMinusOneToOne = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 1]);

/**
 * Une vue-projection ET la convention de profondeur dans laquelle elle sort : les deux voyagent
 * ensemble, parce qu'une profondeur normalisée ne se lit pas sans savoir d'où elle vient. Une
 * `EngineCamera` en est une ; un oracle qui en monte une le déclare, il ne le suppose plus.
 */
export type DepthCamera = { viewProjection: ArrayLike<number>; depthZeroToOne: boolean };

/** Une profondeur normalisée de l'hôte, rendue dans `[0, 1]`. */
export function depthToZeroOne(ndcZ: number, depthZeroToOne: boolean) {
  return depthZeroToOne ? ndcZ : ndcZ * 0.5 + 0.5;
}

/**
 * La vue-projection que le GPU lit, écrite dans `out` : profondeur en `[0, 1]`, quelle que soit la
 * convention de l'hôte. Une caméra qui y est déjà est recopiée — multiplier par l'identité
 * changerait un zéro négatif en zéro positif sans rien apporter.
 */
export function viewProjectionZeroToOne(out: Float64Array, cam: DepthCamera) {
  if (cam.depthZeroToOne) out.set(cam.viewProjection);
  else multiplyMatrix4(out, remapMinusOneToOne, cam.viewProjection);
}
