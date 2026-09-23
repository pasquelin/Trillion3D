// Shared fixtures of `setWebgpuTransform` tests on shear matrices: a minimal Three scene, a
// `WebgpuPagesRuntime` reduced to what `setWebgpuTransform` reads and writes, a selection root, and
// two small comparison helpers. Extracted from `transformCisaillement.test.ts` so
// `transformFiniteTransform.test.ts` reuses them without copying.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BOX_VALUES, boxTransform } from '../../../../sdk-core/src/index.ts';
import { createWebgpuRunState } from '../pages/state/run.ts';
import { hostWorldPlacements, type HostWorldPlacements } from '../../host/world/placements.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts';

/** Two non-orthogonal axes: `y` pushes `x`. No TRS decomposition yields this matrix. */
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
      `${quoi}[${i}]: ${obtenu[i]} instead of ${attendu[i]}`,
    );
}

/** Host scene AND the engine's world-matrix index, the one a move recomputes. */
export function scene(nom = 'cible') {
  const source = new THREE.Object3D(),
    mesh = new THREE.Mesh();
  mesh.name = nom;
  source.add(mesh);
  return { source, mesh, worlds: hostWorldPlacements(source) };
}

/** A minimal selection root: what the transform reprojects and what it sends. The matrix it carries
 *  is the engine's, like every collected root. */
export function racine(mesh: THREE.Object3D, local: number[], worlds: HostWorldPlacements) {
  const localBox = Float64Array.from(local),
    worldBox = new Float64Array(BOX_VALUES),
    world = worlds.of(mesh);
  boxTransform(worldBox, 0, localBox, 0, world.elements);
  return {
    world,
    pages: [{ sourceMesh: mesh } as unknown as PageRec],
    worldBox,
    localBox,
  } as ClusterRoot<PageRec>;
}

export function runtime(
  source: THREE.Object3D,
  roots: Array<ClusterRoot<PageRec>> = [],
  worlds: HostWorldPlacements = hostWorldPlacements(source),
) {
  const mouvements: Array<{ min: number[]; max: number[] }> = [],
    layout = { selectionRoots: roots, rows: { tableEpoch: 0 } },
    // Engine image state, as the runtime carries it: `setWebgpuTransform` increments the scene revision
    // there and aligns `worldsRevision`. A partial state would hide that contract.
    run = createWebgpuRunState();
  run.noOccluderHistory = false;
  run.temporalHizState = { pyramid: {}, camera: {} } as typeof run.temporalHizState;
  const rt = {
    setup: { source, worlds },
    layout,
    run,
    lights: {
      plan: {
        worldChanged: (min: number[], max: number[]) =>
          mouvements.push({ min: [...min], max: [...max] }),
      },
    },
  } as unknown as WebgpuPagesRuntime;
  return { rt, layout, run, mouvements, worlds };
}
