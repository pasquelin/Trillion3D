// Fixtures partagées des tests de `setWebgpuTransform` sur matrices à cisaillement : une scène Three
// minimale, un `WebgpuPagesRuntime` réduit à ce que `setWebgpuTransform` lit et écrit, une racine de
// sélection, et deux petits utilitaires de comparaison. Extrait de `webgpuTransformCisaillement.test.ts`
// pour que `webgpuTransformFiniteTransform.test.ts` les réemploie sans les recopier.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BOX_VALUES, boxTransform } from '../sdk-core/index.ts';
import { createWebgpuRunState } from './webgpuPagesStateRun.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { ClusterRoot, PageRec } from './pageSelectionTypes.ts';

/** Deux axes non orthogonaux : `y` pousse `x`. Aucune décomposition TRS ne rend cette matrice. */
export function cisaillee(facteur = 3, tx = 0) {
  return new THREE.Matrix4().set(1, facteur, 0, tx, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
}

export const versGpu = (m: THREE.Matrix4) => new Float32Array(m.elements);

export function proche(
  obtenu: ArrayLike<number>,
  attendu: ArrayLike<number>,
  tolerance: number,
  quoi: string,
) {
  for (let i = 0; i < attendu.length; i++)
    assert.ok(
      Math.abs(obtenu[i] - attendu[i]) <= tolerance,
      `${quoi}[${i}] : ${obtenu[i]} au lieu de ${attendu[i]}`,
    );
}

export function scene(nom = 'cible') {
  const source = new THREE.Object3D(),
    mesh = new THREE.Mesh();
  mesh.name = nom;
  source.add(mesh);
  source.updateMatrixWorld(true);
  return { source, mesh };
}

/** Une racine de sélection minimale : ce que la transformation reprojette et ce qu'elle envoie. */
export function racine(mesh: THREE.Object3D, local: number[]) {
  const localBox = Float64Array.from(local),
    worldBox = new Float64Array(BOX_VALUES);
  boxTransform(worldBox, 0, localBox, 0, mesh.matrixWorld.elements);
  return {
    world: mesh.matrixWorld,
    pages: [{ sourceMesh: mesh } as unknown as PageRec],
    worldBox,
    localBox,
  } as ClusterRoot<PageRec>;
}

export function runtime(source: THREE.Object3D, roots: Array<ClusterRoot<PageRec>> = []) {
  const mouvements: Array<{ min: number[]; max: number[] }> = [],
    layout = { selectionRoots: roots, rows: { tableEpoch: 0 } },
    // L'état d'image du moteur, tel que le runtime le porte : `setWebgpuTransform` y incrémente la
    // révision de scène et y aligne `worldsRevision`. Un état partiel masquerait ce contrat.
    run = createWebgpuRunState();
  run.noOccluderHistory = false;
  run.temporalHizState = { pyramid: {}, camera: {} } as typeof run.temporalHizState;
  const rt = {
    setup: { source },
    layout,
    run,
    lights: {
      plan: {
        worldChanged: (min: number[], max: number[]) =>
          mouvements.push({ min: [...min], max: [...max] }),
      },
    },
  } as unknown as WebgpuPagesRuntime;
  return { rt, layout, run, mouvements };
}
