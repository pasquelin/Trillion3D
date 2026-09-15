// Lot 4c : les chemins à seuil nul décident sans projeter, et la distance partagée ne change pas
// un bit. Oracle : le chemin général d'avant le lot, recopié dans `bench/oracles/coupe4c.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clusterSphereValid, pageCarriesClusterError } from '../sdk-core/index.ts';
import { cutSelects, projectedClusterError, type ClusterCut } from './pageSelectionMath.ts';
import {
  cutSelectsAtZero,
  errorFloorAt,
  projectedErrorAt,
  viewDistance,
} from './pageSelectionProjection.ts';
import {
  referenceCutSelects,
  referenceErrorFloorPixels,
  referenceProjectCentre,
  referenceProjectedClusterError,
} from './bench/oracles/coupe4c.mjs';

const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.25, 500);
camera.position.set(3, 2, 9);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const view = camera.matrixWorldInverse.elements;
const STRETCH = 1.25,
  FOCAL = 640,
  NEAR = camera.near;
/** Les sphères que la préparation accepte, plus celles qu'elle rejette : le domaine et ses bords. */
const SPHERES: Array<number[] | null | undefined> = [
  [0, 0, 0, 1],
  [40, -3, 120, 0],
  [-1e5, 0, 1e5, 250],
  // Une sphère centrée derrière l'œil, et une qui touche le plan proche.
  [0, 0, 20, 2],
  [3, 2, 9, 0.5],
  null,
  undefined,
];
const ERRORS = [0, -0, 1e-6, 0.5, 4, 1e9, Infinity, undefined, null];

/** Toutes les fiches du produit, sans filtre : le test ne juge que l'accord des deux chemins. */
function* records(): Generator<ClusterCut> {
  for (const lodError of ERRORS)
    for (const sphere of SPHERES)
      for (const parentError of ERRORS)
        for (const parentSphere of [SPHERES[0], SPHERES[2], null])
          yield {
            lodError: lodError as number | undefined,
            sphere: sphere ?? undefined,
            parentError: parentError as number | null | undefined,
            parentSphere,
          };
}

/** Le verdict d'un chemin : sa valeur, ou le fait qu'il a refusé la donnée. */
function verdict(run: () => boolean) {
  try {
    return { value: run(), threw: false };
  } catch {
    return { value: false, threw: true };
  }
}

/** Une fiche que la préparation laisserait passer : erreur finie positive avec sa sphère valide. */
function prepared(rec: ClusterCut) {
  const page = { lodError: rec.lodError, sphere: rec.sphere } as unknown as Parameters<
    typeof pageCarriesClusterError
  >[0];
  const own = rec.lodError === undefined && rec.sphere === undefined;
  if (!own && !pageCarriesClusterError(page)) return false;
  const parent = rec.parentError;
  if (parent === undefined || parent === null) return true;
  if (!Number.isFinite(parent) || parent < (rec.lodError ?? 0)) return false;
  return parent === 0 || clusterSphereValid(rec.parentSphere ?? rec.sphere);
}

test('le chemin général de la coupe est celui d’avant le lot, aux mêmes bits', () => {
  for (const rec of records())
    for (const limit of [0, 1, 7.5]) {
      const optimise = verdict(() => cutSelects(rec, view, STRETCH, FOCAL, NEAR, limit));
      const reference = verdict(() => referenceCutSelects(rec, view, STRETCH, FOCAL, NEAR, limit));
      assert.deepEqual(optimise, reference, JSON.stringify(rec) + ` seuil ${limit}`);
    }
});

test('à seuil nul, la coupe sans projection décide comme celle qui projette', () => {
  let vus = 0;
  for (const rec of records()) {
    if (!prepared(rec)) continue;
    vus++;
    const sansProjection = verdict(() => cutSelectsAtZero(rec));
    const avec = verdict(() => cutSelects(rec, view, STRETCH, FOCAL, NEAR, 0));
    assert.deepEqual(sansProjection, avec, JSON.stringify(rec));
  }
  // La garde du test lui-même : le domaine préparé n'est pas vide.
  assert.ok(vus > 100, `seulement ${vus} fiches préparées`);
});

test('une erreur propre mal formée est refusée des deux côtés quand la sphère est là', () => {
  for (const lodError of [-1, Number.NaN]) {
    const rec: ClusterCut = { lodError, sphere: [0, 0, 20, 1], parentError: 1 };
    assert.throws(() => cutSelectsAtZero(rec));
    assert.throws(() => cutSelects(rec, view, STRETCH, FOCAL, NEAR, 0));
  }
});

test('la distance partagée rend les projections d’avant le lot, aux mêmes bits', () => {
  for (const sphere of SPHERES) {
    if (!sphere) continue;
    const distance = viewDistance(sphere, 0, view);
    const centre = referenceProjectCentre(sphere, 0, view);
    assert.equal(distance, Math.hypot(centre[0], centre[1], centre[2]));
    for (const error of ERRORS) {
      assert.deepEqual(
        verdict(() =>
          Object.is(
            projectedErrorAt(
              error as number | null | undefined,
              distance,
              sphere[3],
              STRETCH,
              FOCAL,
              NEAR,
            ),
            referenceProjectedClusterError(error, sphere, 0, view, STRETCH, FOCAL, NEAR),
          ),
        ),
        { value: true, threw: false },
        `projection ${error} ${sphere}`,
      );
      assert.ok(
        Object.is(
          errorFloorAt(error as number, distance, sphere[3], STRETCH, FOCAL),
          referenceErrorFloorPixels(
            error,
            STRETCH,
            referenceProjectCentre(sphere, 0, view),
            sphere[3],
            FOCAL,
          ),
        ),
        `plancher ${error} ${sphere}`,
      );
      assert.ok(
        Object.is(
          projectedClusterError(error as number, sphere, 0, view, STRETCH, FOCAL, NEAR),
          referenceProjectedClusterError(error, sphere, 0, view, STRETCH, FOCAL, NEAR),
        ) || !Number.isFinite(error as number),
        `erreur projetée ${error} ${sphere}`,
      );
    }
  }
});
