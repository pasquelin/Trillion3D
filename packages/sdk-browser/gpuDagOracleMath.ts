import * as THREE from 'three';
import { screenErrorBound } from '../sdk-core/index.ts';
import { viewDepthOf, viewLateralOf } from './pageSelectionProjection.ts';

export const dagScratch = {
  view: new THREE.Matrix4(),
  world: new THREE.Matrix4(),
  viewMatrix: new THREE.Matrix4(),
  cone: { axis: [0, 0, 1] as [number, number, number], angle: Math.PI },
  min: [0, 0, 0] as number[],
  max: [0, 0, 0] as number[],
};

/**
 * Miroir CPU de `projected` du nuanceur `gpuDagShader.ts` : mêmes gardes, mêmes opérandes, même
 * ordre. Le nuanceur ne lève pas, donc l'oracle ne lève pas non plus — une erreur négative ou NaN y
 * rend l'infini, là où `clusterErrorAtDepth` de sdk-core refuse ses paramètres. Ce sont deux
 * contrats différents de la même borne `screenErrorBound` : la fonction validante ne peut pas
 * remplacer celle-ci.
 */
export function projectedError(
  error: number,
  sx: number,
  sy: number,
  sz: number,
  radius: number,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
) {
  if (error === 0) return 0;
  if (!(error > 0)) return Infinity;
  const lateral = viewLateralOf(sx, sy, sz, e);
  return screenErrorBound(error, stretch, lateral, viewDepthOf(sx, sy, sz, e), radius, focal, near);
}
