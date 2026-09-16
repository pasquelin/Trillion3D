// Géométrie, caméra, vérité terrain et décision CPU partagées par la reproduction du défaut 6
// (`inverseTranspose3`, gpuDagShader.ts). Séparé de l'orchestration pour tenir `check:lines`.
import * as THREE from 'three';
import {
  frustumExcludesBox,
  frustumPlanesFromMatrix,
  frustumPlanesToLocal,
} from '../../../sdk-core/index.ts';
import {
  coneContextFor,
  coneCullsPageWith,
  createConeContext,
  triangleCone,
} from '../../pageCone.ts';
import { packDagSelection } from '../../gpuDagSelection.ts';
import { selectVisiblePages } from '../../pageSelectionCut.ts';
import { poseMonde } from './normaleEclairageCas.mjs';
import { cameraMoteur } from '../../cameraFixture.ts';

export const VIEWPORT = [1000, 1000];
// Caméra fixe : sur -Z, elle regarde l'origine où chaque objet est recentré quelle que soit sa
// rotation (voir `construireCas`), pour que seule l'orientation varie d'un cas à l'autre.
export const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 0, -9);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
/** La caméra du moteur de ce décor, posée une fois : le CPU et le noyau GPU lisent la même. */
export const vue = cameraMoteur(camera);
const WORLD_PLANES = new Float64Array(24);
frustumPlanesFromMatrix(WORLD_PLANES, vue.viewProjection);

/**
 * Deux triangles partageant l'origine locale, comme le lot 1 : normales (±1,0,1)/√2, cône local
 * d'axe (0,0,1) et de demi-angle 45°. `L` fixe l'échelle des coordonnées locales ; le monde reste
 * de taille `worldSize` quel que soit `s` puisque `L = worldSize / s`.
 */
function geometrieLocale(L) {
  const positions = [0, 0, 0, L, 0, -L, 0, L, 0, 0, 0, 0, -L, 0, -L, 0, -L, 0];
  const indices = [0, 1, 2, 3, 4, 5];
  return { positions, indices, min: [-L, -L, -L], max: [L, L, 0] };
}

/**
 * Rotation + échelle (uniforme ou non), recentrées à l'origine monde quelle que soit la rotation.
 * `miroir` inverse la troisième colonne de la 3×3 : la transformation reste conforme (colonnes
 * orthogonales de même longueur) mais son déterminant change de signe. La pose vient de
 * `poseMonde` : les défauts 6 et 9 éprouvent la même famille de matrices.
 */
export function construireCas({ s, kind, worldSize, axis, angleDeg, miroir = false }) {
  const L = worldSize / s;
  const { positions, indices, min, max } = geometrieLocale(L);
  const cone = triangleCone(positions, indices);
  const world = poseMonde({ s, kind, axis, angleDeg });
  if (miroir) for (const k of [8, 9, 10]) world.elements[k] = -world.elements[k];
  const centerLocal = new THREE.Vector3(
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  );
  world.setPosition(centerLocal.applyMatrix4(world).negate());
  return { positions, indices, cone, min, max, world, s, kind, worldSize, axis, angleDeg, miroir };
}

/**
 * Orientation géométrique BRUTE : vrais sommets transformés, `cross(e1, e2)` contre la caméra,
 * champ, aire en pixels. Ce n'est pas ce que le moteur dessine — sous réflexion il échange la face
 * éliminée (`windingCw`), et `avantVisible` désigne alors la face opposée à celle qui sort à
 * l'écran. Pour la vérité du moteur, mesurée par rasterisation réelle, voir `reflexion-cone.mjs`.
 */
export function veriteTerrain(cas) {
  const triangles = [
    [0, 1, 2],
    [3, 4, 5],
  ].map(([ia, ib, ic]) => {
    const v = [ia, ib, ic].map((i) =>
      new THREE.Vector3().fromArray(cas.positions, i * 3).applyMatrix4(cas.world),
    );
    const normale = new THREE.Vector3()
      .subVectors(v[1], v[0])
      .cross(new THREE.Vector3().subVectors(v[2], v[0]));
    normale.normalize();
    const centre = v[0].clone().add(v[1]).add(v[2]).divideScalar(3);
    const face = normale.dot(camera.position.clone().sub(centre).normalize());
    const ndc = v.map((p) => p.clone().project(camera));
    const dansLeChamp = ndc.every(
      (p) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1,
    );
    const airePixels =
      (Math.abs(
        (ndc[1].x - ndc[0].x) * (ndc[2].y - ndc[0].y) -
          (ndc[2].x - ndc[0].x) * (ndc[1].y - ndc[0].y),
      ) *
        (VIEWPORT[0] / 2) *
        (VIEWPORT[1] / 2)) /
      2;
    return { face, dansLeChamp, airePixels };
  });
  const avantVisible = triangles.some((t) => t.face > 0 && t.dansLeChamp && t.airePixels > 1);
  return { triangles, avantVisible };
}

/** Ce qu'une page de cas porte toujours : sa boîte locale, son cône, une erreur de niveau nulle. */
const pageDuCas = (cas) => ({
  url: '0',
  lodError: 0,
  min: cas.min,
  max: cas.max,
  cone: cas.cone,
});

/**
 * Les cas empaquetés pour le noyau GPU : une racine par cas, une page par racine, la sphère du cas
 * pour rayon. Écrit une seule fois pour la campagne comme pour la preuve `test/` du défaut 6.
 */
export const empaqueteCas = (liste) =>
  packDagSelection(
    liste.map((cas) => ({
      world: cas.world,
      pages: [{ ...pageDuCas(cas), parentError: null, sphere: [0, 0, 0, cas.worldSize] }],
    })),
  );

/** Le cluster est-il dans le champ (boîte locale contre les plans ramenés en repère local) ? */
export function dansLeChamp(cas) {
  const local = new Float64Array(24);
  frustumPlanesToLocal(local, WORLD_PLANES, cas.world.elements);
  return !frustumExcludesBox(local, ...cas.min, ...cas.max);
}

/** `coneCullsPageWith` et `selectVisiblePages`, comme le lot 1 : la même page, les deux entrées. */
export function decisionCpu(cas) {
  const ctx = coneContextFor(createConeContext(), cas.world, vue);
  const coneRejette = coneCullsPageWith(ctx, cas.cone, cas.world, cas.min, cas.max);
  const box = new THREE.Box3(
    new THREE.Vector3(...cas.min),
    new THREE.Vector3(...cas.max),
  ).applyMatrix4(cas.world);
  const page = {
    ...pageDuCas(cas),
    id: '0',
    triangles: 2,
    matrix: cas.world,
    material: new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  };
  const root = {
    world: cas.world,
    pages: [page],
    cones: true,
    worldBox: new Float64Array([...box.min.toArray(), ...box.max.toArray()]),
  };
  const triangles = selectVisiblePages([root], vue, {
    pixelError: 0,
    viewport: VIEWPORT,
  }).displayedTriangles;
  return { conforme: ctx.conformal, coneRejette, rejette: triangles === 0, triangles };
}
