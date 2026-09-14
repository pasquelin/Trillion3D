import * as THREE from 'three';
import {
  RECTS_PER_SLICE,
  faceCountOf,
  writeFaceMatrix,
  type ShadowViewpoint,
} from '../sdk-core/index.ts';
import { BASE_SLOTS } from './gpuDraw.ts';
import { MAX_FACES_PER_FRAME, SHADOW_PASS } from './gpuShadowAtlas.ts';
import { visGroupFor } from './webgpuVisibilityDrawer.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const scratchVector = new THREE.Vector3();
const viewpoint: ShadowViewpoint & {
  position: [number, number, number];
  forward: [number, number, number];
} = { position: [0, 0, 0], forward: [0, 0, -1], halfFovY: 0.5, far: 1000 };
/** Rectangles des faces de l'image, en texels d'atlas ; alloués une fois pour le budget d'une image. */
const faceRects = new Int32Array(MAX_FACES_PER_FRAME * 3);
/** Slots indirects non vides de l'image, alloués une fois pour toutes les couches nommables. */
const drawSlots = new Int32Array(BASE_SLOTS * 16);

/** La vue que l'ordonnanceur lit : position, axe, demi-champ vertical et distance maximale. */
function shadowViewpointOf(camera: THREE.PerspectiveCamera) {
  camera.getWorldPosition(scratchVector).toArray(viewpoint.position);
  camera.getWorldDirection(scratchVector).toArray(viewpoint.forward);
  viewpoint.halfFovY = Math.max(1e-3, (camera.fov * Math.PI) / 360);
  viewpoint.far = camera.far;
  return viewpoint;
}

/**
 * Choisit les lampes à ombre de cette image et écrit leurs matrices de face. Rend le nombre de faces
 * à dessiner ; le rectangle d'atlas de chaque face est déjà réservé par l'ordonnanceur.
 */
export function planShadowFaces(rt: WebgpuPagesRuntime, camera: THREE.PerspectiveCamera) {
  const { lights } = rt,
    { shadows, plan, store, faceMatrices } = lights;
  lights.shadowsUpdated = 0;
  lights.shadowsDenied = 0;
  lights.shadowsPending = 0;
  lights.shadowFaces = 0;
  lights.shadowDraws = 0;
  lights.shadowDrawCalls = 0;
  if (!shadows || !store.count) return 0;
  const updates = plan.plan(store, shadowViewpointOf(camera));
  lights.shadowsDenied = plan.denied;
  lights.shadowsPending = plan.pending;
  let faces = 0;
  for (let update = 0; update < updates; update++) {
    const slice = plan.updatedSlice[update];
    const light = store.light(store.ids[plan.updatedLight[update]]);
    if (!light) continue;
    const count = faceCountOf(light);
    for (let face = 0; face < count && faces < MAX_FACES_PER_FRAME; face++) {
      const base = faces * 16,
        rect = slice * RECTS_PER_SLICE + face * 3;
      const planes = writeFaceMatrix(faceMatrices, base, light, face);
      if (!face)
        shadows.writeSliceInfo(
          slice,
          count,
          Math.tan(planes.halfFov),
          plan.slices.side[slice],
          planes.near,
        );
      shadows.writeFace(faces, slice, face, faceMatrices, base, plan.slices.rects);
      faceRects[faces * 3] = plan.slices.rects[rect];
      faceRects[faces * 3 + 1] = plan.slices.rects[rect + 1];
      faceRects[faces * 3 + 2] = plan.slices.rects[rect + 2];
      faces++;
    }
  }
  if (faces) {
    shadows.flushFaces(faces);
    shadows.flushSlices();
  }
  lights.shadowsUpdated = updates;
  lights.shadowFaces = faces;
  return faces;
}

/**
 * La passe de profondeur des ombres : une seule passe de rendu pour toutes les faces de l'image, le
 * cadre et les ciseaux placés sur chaque tranche, chaque tranche remise au fond puis dessinée avec la
 * sélection de clusters et le tampon indirect de l'image principale.
 */
export function encodeShadowAtlas(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  faces: number,
) {
  const { lights, vis, run, layout } = rt,
    { shadows } = lights,
    { gpuDraw } = vis;
  if (!faces || !shadows || !gpuDraw || !vis.visBindGroupLayout) return false;
  let slots = 0;
  for (let layer = 0; layer < vis.drawLayerSlots; layer++)
    for (let slot = layer * BASE_SLOTS; slot < (layer + 1) * BASE_SLOTS; slot++)
      if (layout.binInstances[slot] && slots < drawSlots.length) drawSlots[slots++] = slot;
  const first = slots ? visGroupFor(rt, device, drawSlots[0], false) : undefined;
  lights.shadowDraws = first ? slots : 0;
  if (!first) return false;
  const drawsBefore = run.gpuDrawCalls;
  const pass = encoder.beginRenderPass({
    label: SHADOW_PASS,
    colorAttachments: [],
    depthStencilAttachment: { view: shadows.view, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  for (let face = 0; face < faces; face++) {
    const x = faceRects[face * 3],
      y = faceRects[face * 3 + 1],
      side = faceRects[face * 3 + 2];
    if (side <= 0) continue;
    pass.setViewport(x, y, side, side, 0, 1);
    pass.setScissorRect(x, y, side, side);
    pass.setBindGroup(1, shadows.faceGroup, [face * shadows.faceStride]);
    pass.setPipeline(shadows.clear);
    pass.setBindGroup(0, first);
    pass.draw(3);
    run.gpuDrawCalls++;
    pass.setPipeline(shadows.depth);
    for (let index = 0; index < slots; index++) {
      const group = visGroupFor(rt, device, drawSlots[index], false);
      if (!group) continue;
      pass.setBindGroup(0, group);
      pass.drawIndirect(gpuDraw.indirectBuffer, drawSlots[index] * 16);
      run.gpuDrawCalls++;
    }
  }
  pass.end();
  lights.shadowDrawCalls = run.gpuDrawCalls - drawsBefore;
  return true;
}
