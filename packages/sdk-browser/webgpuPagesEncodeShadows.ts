import * as THREE from 'three';
import {
  RECTS_PER_SLICE,
  SHADOW_CULL_FLOATS,
  faceCountOf,
  writeFaceCull,
  writeFaceMatrix,
  type ShadowViewpoint,
} from '../sdk-core/index.ts';
import { MAX_FACES_PER_FRAME } from './gpuShadowAtlas.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const scratchVector = new THREE.Vector3();
const viewpoint: ShadowViewpoint & {
  position: [number, number, number];
  forward: [number, number, number];
} = {
  position: [0, 0, 0],
  forward: [0, 0, -1],
  halfFovY: 0.5,
  aspect: 1,
  near: 0.1,
  far: 1000,
};
/** Rectangles des faces de l'image, en texels d'atlas ; alloués une fois pour le budget d'une image. */
export const faceRects = new Int32Array(MAX_FACES_PER_FRAME * 3);

/**
 * La vue que l'ordonnanceur lit : position, axe, demi-champ vertical, rapport d'image, plans proche
 * et lointain. Les cascades du soleil en dérivent entièrement — elles suivent la caméra et rien
 * d'autre — et la moindre de ces valeurs qui change périme leurs cartes.
 */
function shadowViewpointOf(camera: THREE.PerspectiveCamera) {
  camera.getWorldPosition(scratchVector).toArray(viewpoint.position);
  camera.getWorldDirection(scratchVector).toArray(viewpoint.forward);
  viewpoint.halfFovY = Math.max(1e-3, (camera.fov * Math.PI) / 360);
  viewpoint.aspect = Math.max(1e-3, camera.aspect);
  viewpoint.near = camera.near;
  viewpoint.far = camera.far;
  return viewpoint;
}

/**
 * Choisit les lampes à ombre de cette image et écrit, par face, sa matrice et le volume que le
 * rejet lui oppose. Rend le nombre de faces à dessiner ; le rectangle d'atlas de chaque face est
 * déjà réservé par l'ordonnanceur.
 */
export function planShadowFaces(rt: WebgpuPagesRuntime, camera: THREE.PerspectiveCamera) {
  const { lights } = rt,
    { shadows, cull, plan, store, faceMatrices } = lights;
  lights.shadowsUpdated = 0;
  lights.shadowFaces = 0;
  lights.sunCascades = 0;
  lights.shadowDraws = 0;
  lights.shadowDrawCalls = 0;
  if (!shadows || !store.count) return 0;
  const view = shadowViewpointOf(camera);
  const updates = plan.plan(store, view);
  let faces = 0;
  for (let update = 0; update < updates; update++) {
    const slice = plan.updatedSlice[update];
    const light = store.light(store.ids[plan.updatedLight[update]]);
    if (!light) continue;
    const count = faceCountOf(light);
    const side = plan.slices.side[slice];
    for (let face = 0; face < count && faces < MAX_FACES_PER_FRAME; face++) {
      const base = faces * 16,
        rect = slice * RECTS_PER_SLICE + face * 3;
      const planes = writeFaceMatrix(faceMatrices, base, light, face, view, side);
      if (cull) writeFaceCull(cull.volumes, faces * SHADOW_CULL_FLOATS, light, face, view, side);
      if (!face) shadows.writeSliceInfo(slice, count, Math.tan(planes.halfFov), side, planes.near);
      shadows.writeFace(faces, slice, face, faceMatrices, base, plan.slices.rects);
      faceRects[faces * 3] = plan.slices.rects[rect];
      faceRects[faces * 3 + 1] = plan.slices.rects[rect + 1];
      faceRects[faces * 3 + 2] = plan.slices.rects[rect + 2];
      if (light.kind === 'directional') lights.sunCascades++;
      faces++;
    }
  }
  if (faces) {
    shadows.flushFaces(faces);
    shadows.flushSlices(plan.updatedSlice, updates);
  }
  lights.shadowsUpdated = updates;
  lights.shadowFaces = faces;
  return faces;
}
