// Defect 10: what the engine actually draws under a negative-determinant transform.
//
// Defect 6's batch left 54 drops of "visible" faces, all reflections, and proposed the reading
// that `cross(M·e1,M·e2) = det(M)·M⁻ᵀ·n` changes sign, so the cone axis should be multiplied by
// `sign(det)`. Its ground truth (`veriteTerrain`) is the RAW geometric orientation of the
// transformed vertices, which ignores that the engine itself swaps the culled face under
// reflection — `windingCw` in WebGPU, `frontFaceCW = determinant() < 0` in Three on WebGL. This
// module opposes the two truths: the raw one and the engine's, measured in fragments actually
// covered by rasterisation.
import * as THREE from 'three';
import { surfaceOf } from '../../packages/sdk-browser/pageSurface.ts';
import { windingCw } from '../../packages/sdk-browser/webgpuPagesWinding.ts';
import type { PageRec } from '../../packages/sdk-browser/pageSelectionTypes.ts';
import { camera } from './inverseTransposeCas.ts';
import type { Cas } from './inverseTransposeCas.ts';

const TRIANGLES = [
  [0, 1, 2],
  [3, 4, 5],
];
/** A square view fine enough that each case covers thousands of pixels, small enough that the
 *  6 916 CPU and GPU rasterisations fit in a few seconds. */
export const VUE: [number, number] = [128, 128];

/** The case seen as a visibility-buffer page: a front face, two triangles, its matrix. */
export function pageVisible(cas: Cas) {
  const geometrie = new THREE.BufferGeometry();
  geometrie.setAttribute('position', new THREE.Float32BufferAttribute(cas.positions, 3));
  return {
    array: new Uint32Array(cas.indices),
    attributes: geometrie.attributes,
    matrix: cas.world,
    material: surfaceOf(new THREE.MeshBasicMaterial({ side: THREE.FrontSide })),
  };
}

/** `viewProj` matrix of the shared camera, column-major, as the engine assembles it. */
export function viewProjection(): number[] {
  camera.updateWorldMatrix(true, false);
  return [
    ...new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .elements,
  ];
}

/**
 * Winding the engine would apply to this case: its own `windingCw` function, on a page record
 * that only carries the world matrix. Nothing is rewritten here.
 */
export function sensDuMoteur(cas: Cas): 'cw' | 'ccw' {
  // `windingCw` only reads `matrix` (and caches on `windingEpoch`/`windingCw`), as its own
  // doc says; the rest of `PageRec` belongs to the selection pipeline, not to this probe.
  return windingCw({ matrix: cas.world } as unknown as PageRec) ? 'cw' : 'ccw';
}

/**
 * `rasterGpu` payload for a list of cases: vertices transformed in double precision — the
 * question asked is orientation, not rounding — grouped by winding, one counter slot per case.
 */
export function chargeRaster(cas: Cas[]) {
  const groupes: { ccw: number[]; cw: number[] } = { ccw: [], cw: [] };
  for (let i = 0; i < cas.length; i++) groupes[sensDuMoteur(cas[i])].push(i);
  const sommets: number[] = [];
  const bornes: Array<['ccw' | 'cw', number, number]> = [];
  for (const sens of ['ccw', 'cw'] as const) {
    const debut = sommets.length / 4;
    for (const i of groupes[sens])
      for (const triangle of TRIANGLES)
        for (const sommet of triangle) {
          const p = new THREE.Vector3()
            .fromArray(cas[i].positions, sommet * 3)
            .applyMatrix4(cas[i].world);
          sommets.push(p.x, p.y, p.z, i);
        }
    bornes.push([sens, debut, sommets.length / 4 - debut]);
  }
  return {
    sommets,
    bornes,
    viewProj: viewProjection(),
    largeur: VUE[0],
    hauteur: VUE[1],
    slots: cas.length,
  };
}
