// Geometry, camera, ground truth and CPU decision shared by the defect-6 reproduction
// (`inverseTranspose3`, gpuDagShader.ts). Split from the orchestration to hold `check:lines`.
import * as THREE from 'three';
import {
  frustumExcludesBox,
  frustumPlanesFromMatrix,
  frustumPlanesToLocal,
} from '../../packages/sdk-core/index.ts';
import {
  coneContextFor,
  coneCullsPageWith,
  createConeContext,
  triangleCone,
} from '../../packages/sdk-browser/pageCone.ts';
import {
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../packages/sdk-browser/gpuDagSelection.ts';
import { selectVisiblePages } from '../../packages/sdk-browser/pageSelectionCut.ts';
import { poseMonde } from './normaleEclairageCas.mjs';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';

export const VIEWPORT = [1000, 1000];
// Fixed camera: on -Z, it looks at the origin where each object is recentred whatever its
// rotation (see `construireCas`), so that only orientation varies from case to case.
export const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 0, -9);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
/** This fixture's engine camera, posed once: CPU and GPU kernel read the same one. */
export const vue = cameraMoteur(camera);
const WORLD_PLANES = new Float64Array(24);
frustumPlanesFromMatrix(WORLD_PLANES, vue.viewProjection);

/**
 * Two triangles sharing the local origin, as in batch 1: normals (±1,0,1)/√2, local cone
 * of axis (0,0,1) and half-angle 45°. `L` fixes the scale of local coordinates; the world stays
 * of size `worldSize` whatever `s` since `L = worldSize / s`.
 */
function geometrieLocale(L) {
  const positions = [0, 0, 0, L, 0, -L, 0, L, 0, 0, 0, 0, -L, 0, -L, 0, -L, 0];
  const indices = [0, 1, 2, 3, 4, 5];
  return { positions, indices, min: [-L, -L, -L], max: [L, L, 0] };
}

/**
 * Rotation + scale (uniform or not), recentred at the world origin whatever the rotation.
 * `miroir` negates the third column of the 3×3: the transform stays conformal (orthogonal
 * columns of equal length) but its determinant changes sign. The pose comes from
 * `poseMonde`: defects 6 and 9 exercise the same family of matrices.
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
 * RAW geometric orientation: true transformed vertices, `cross(e1, e2)` against the camera,
 * frustum, area in pixels. This is not what the engine draws — under reflection it swaps the
 * culled face (`windingCw`), and `avantVisible` then names the face opposite the one that
 * comes out on screen. For the engine's truth, measured by real rasterisation, see
 * `reflexion-cone.mjs`.
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

/** What a case page always carries: its local box, its cone, a null level error. */
const pageDuCas = (cas) => ({
  url: '0',
  lodError: 0,
  min: cas.min,
  max: cas.max,
  cone: cas.cone,
});

/**
 * Cases packed for the GPU kernel: one root per case, one page per root, the case's sphere
 * for radius. Written once for the campaign as for defect 6's `test/` proof.
 */
// The kernel works in the render frame: packed world matrices are brought back to
// the eye, as the engine feeds them, or else relative view and absolute world would mix.
export const empaqueteCas = (liste) =>
  packedWorldsToRenderOrigin(
    packDagSelection(
      liste.map((cas) => ({
        world: cas.world,
        pages: [{ ...pageDuCas(cas), parentError: null, sphere: [0, 0, 0, cas.worldSize] }],
      })),
    ),
    liste,
    vue.eye,
  );

/** Is the cluster in the frustum (local box against the planes brought into local space)? */
export function dansLeChamp(cas) {
  const local = new Float64Array(24);
  frustumPlanesToLocal(local, WORLD_PLANES, cas.world.elements);
  return !frustumExcludesBox(local, ...cas.min, ...cas.max);
}

/** `coneCullsPageWith` and `selectVisiblePages`, as in batch 1: the same page, both entries. */
export function decisionCpu(cas) {
  const ctx = coneContextFor(createConeContext(), cas.world, vue.eye);
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
