import * as THREE from 'three';
import { viewDistanceOf } from './pageSelectionProjection.ts';

export const dagScratch = {
  view: new THREE.Matrix4(),
  world: new THREE.Matrix4(),
  viewMatrix: new THREE.Matrix4(),
  cam: new THREE.PerspectiveCamera(),
  cone: { axis: [0, 0, 1] as [number, number, number], angle: Math.PI },
  min: [0, 0, 0] as number[],
  max: [0, 0, 0] as number[],
};

/**
 * Miroir CPU de `projected` du nuanceur `gpuDagShader.ts` : mêmes gardes, mêmes opérandes, même
 * ordre. Le nuanceur ne lève pas, donc l'oracle ne lève pas non plus — une erreur négative ou NaN y
 * rend l'infini, là où `clusterErrorAtDistance` de sdk-core refuse ses paramètres. Ce sont deux
 * contrats différents du même quotient : la fonction validante ne peut pas remplacer celle-ci.
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
  const distance = viewDistanceOf(sx, sy, sz, e) - radius * stretch;
  if (!(distance > near)) return Infinity;
  return (error * stretch * focal) / distance;
}
