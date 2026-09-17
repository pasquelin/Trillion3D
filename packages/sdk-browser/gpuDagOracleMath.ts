import * as THREE from 'three';
import { frustumExcludesBox, frustumPlanesToLocal, screenErrorBound } from '../sdk-core/index.ts';
import { viewDepthOf, viewLateralOf } from './pageSelectionProjection.ts';
import { DAG_NODE_FLOATS } from './gpuDagTypes.ts';
import type { SelectionUniforms } from './gpuSelection.ts';

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

/**
 * Ce qu'une image pose par primitive avant toute descente : les plans du tronc ramenés dans l'espace
 * de la primitive, la matrice vue·monde, et l'étirement objet-vue. Deux descentes processeur le
 * demandaient mot pour mot — l'oracle (`gpuDagOracle.ts`) et le comptage de frontière
 * (`gpuDagCutFrontierFixture.ts`) — ; il n'est écrit qu'ici, si bien qu'aucune des deux ne peut
 * dériver du noyau sans que l'autre le fasse aussi.
 */
export type DagViewFrames = {
  planes: Float64Array[];
  views: number[][];
  stretches: number[];
  focal: number;
  near: number;
  pixelError: number;
};
export function dagViewFrames(
  packed: { worlds: Float32Array; worldStretch: Float32Array; worldCount: number },
  uniforms: SelectionUniforms,
): DagViewFrames {
  const cameraStretch = uniforms.cameraStretch ?? 1;
  const planes: Float64Array[] = [],
    views: number[][] = [],
    stretches: number[] = [];
  const { view, world, viewMatrix } = dagScratch;
  view.fromArray(uniforms.view);
  for (let w = 0; w < packed.worldCount; w++) {
    world.fromArray(packed.worlds.subarray(w * 16, w * 16 + 16));
    const object = new Float64Array(24);
    frustumPlanesToLocal(object, uniforms.planes, world.elements);
    planes.push(object);
    viewMatrix.multiplyMatrices(view, world);
    views.push([...viewMatrix.elements]);
    stretches.push(packed.worldStretch[w] * cameraStretch);
  }
  return {
    planes,
    views,
    stretches,
    focal: Math.max(uniforms.pixelScale[0], uniforms.pixelScale[1]),
    near: uniforms.near,
    pixelError: uniforms.pixelError,
  };
}

/** Le verdict du noyau sur un nœud de coupe (`gpuDagLevelWgsl.ts`, `levelStep`) : `-1` rejeté —
 *  hors tronc, ou dont aucun remplaçant du sous-arbre n'est encore trop grossier —, sinon le nombre
 *  d'enfants qu'il ouvre, `0` désignant une feuille retenue. */
export function dagNodeVerdict(
  f: DagViewFrames,
  nodes: ArrayLike<number>,
  ints: Uint32Array,
  n: number,
) {
  const base = n * DAG_NODE_FLOATS,
    w = ints[base + 12];
  if (
    frustumExcludesBox(
      f.planes[w],
      nodes[base],
      nodes[base + 1],
      nodes[base + 2],
      nodes[base + 4],
      nodes[base + 5],
      nodes[base + 6],
    )
  )
    return -1;
  const ceil = nodes[base + 7];
  if (
    ceil >= 0 &&
    projectedError(
      ceil,
      nodes[base + 8],
      nodes[base + 9],
      nodes[base + 10],
      nodes[base + 11],
      f.views[w],
      f.stretches[w],
      f.focal,
      f.near,
    ) <= f.pixelError
  )
    return -1;
  return ints[base + 15];
}
