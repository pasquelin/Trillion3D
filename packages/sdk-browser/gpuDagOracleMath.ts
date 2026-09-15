import * as THREE from 'three';
import type { SelectionUniforms } from './gpuSelection.ts';
import { boxClip } from './pageSelectionMath.ts';
import { viewDistanceOf } from './pageSelectionProjection.ts';

export const dagScratch = {
  view: new THREE.Matrix4(),
  world: new THREE.Matrix4(),
  viewMatrix: new THREE.Matrix4(),
  cam: new THREE.PerspectiveCamera(),
  cone: { axis: [0, 0, 1] as [number, number, number], angle: Math.PI },
  min: [0, 0, 0] as number[],
  max: [0, 0, 0] as number[],
  planes: new Float64Array(24),
};

export function objectPlanes(
  uniforms: SelectionUniforms,
  world: THREE.Matrix4,
  into: Float64Array,
) {
  const m = world.elements,
    source = uniforms.planes;
  for (let i = 0; i < 6; i++) {
    const a = source[i * 4],
      b = source[i * 4 + 1],
      c = source[i * 4 + 2],
      d = source[i * 4 + 3];
    into[i * 4] = m[0] * a + m[1] * b + m[2] * c + m[3] * d;
    into[i * 4 + 1] = m[4] * a + m[5] * b + m[6] * c + m[7] * d;
    into[i * 4 + 2] = m[8] * a + m[9] * b + m[10] * c + m[11] * d;
    into[i * 4 + 3] = m[12] * a + m[13] * b + m[14] * c + m[15] * d;
  }
}
/**
 * Boîte entièrement hors des six plans : c'est le verdict de rejet de `boxClip`, dont la première
 * passe teste exactement ce sommet-là, dans le même ordre, avec les mêmes produits et la même
 * somme. Une seule écriture du test, deux lectures — le booléen ici, les trois états là-bas.
 */
export function outsidePlanes(
  planes: Float64Array,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  return boxClip(planes, minX, minY, minZ, maxX, maxY, maxZ) === 0;
}
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
