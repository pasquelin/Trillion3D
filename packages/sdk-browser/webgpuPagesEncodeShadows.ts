import {
  LIGHT_KIND,
  RECTS_PER_SLICE,
  SHADOW_CULL_FLOATS,
  SHADOW_PAGE,
  faceCountOf,
  pageRowsOf,
  regionRect,
  writeFace,
  type ShadowViewpoint,
} from '../sdk-core/index.ts';
import { MAX_SHADOW_REGIONS } from './gpuShadowAtlas.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { EngineCamera } from './cameraWorld.ts';

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
const rectScratch = new Float64Array(4);
/**
 * Par région : le ciseau qui la borne, puis le cadre de sa face entière. Le cadre est celui de la
 * face et non celui de la région — c'est lui qui décide où un sommet atterrit, et le garder entier
 * est ce qui rend le dessin par pages identique au bit près à un redessin complet. Seul le ciseau
 * change. Alloués une fois pour le budget d'une image.
 */
export const regionScissor = new Int32Array(MAX_SHADOW_REGIONS * 4);
export const regionViewport = new Int32Array(MAX_SHADOW_REGIONS * 3);
const flushedSlices = new Int32Array(MAX_SHADOW_REGIONS);

/**
 * La vue que l'ordonnanceur lit : position, axe, demi-champ vertical, rapport d'image, plans proche
 * et lointain. Les cascades du soleil en dérivent entièrement — elles suivent la caméra et rien
 * d'autre.
 */
function shadowViewpointOf(cam: EngineCamera) {
  // Lues dans la matrice monde que l'entrée d'image a recopiée, ancêtres compris : l'axe est celui
  // de `Camera.getWorldDirection`, troisième colonne normalisée puis opposée — même division par la
  // longueur, même signe, mêmes bits.
  const world = cam.world;
  viewpoint.position[0] = cam.position[0];
  viewpoint.position[1] = cam.position[1];
  viewpoint.position[2] = cam.position[2];
  const fx = world[8],
    fy = world[9],
    fz = world[10];
  const inverse = 1 / (Math.sqrt(fx * fx + fy * fy + fz * fz) || 1);
  viewpoint.forward[0] = -(fx * inverse);
  viewpoint.forward[1] = -(fy * inverse);
  viewpoint.forward[2] = -(fz * inverse);
  viewpoint.halfFovY = Math.max(1e-3, (cam.fov * Math.PI) / 360);
  viewpoint.aspect = Math.max(1e-3, cam.aspect);
  viewpoint.near = cam.near;
  viewpoint.far = cam.far;
  return viewpoint;
}

/**
 * Choisit les régions d'ombre de cette image — des rectangles de pages, pas des faces entières — et
 * écrit, pour chacune, sa matrice et le volume que le rejet lui oppose. Rend leur nombre ; le
 * rectangle d'atlas de chaque face est déjà réservé par l'ordonnanceur.
 */
export function planShadowRegions(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  frame: number,
  nowMs: number,
) {
  const { lights } = rt,
    { shadows, cull, plan, store, faceMatrices } = lights;
  lights.shadowsUpdated = 0;
  lights.shadowFaces = 0;
  lights.sunCascades = 0;
  lights.shadowRegions = 0;
  lights.shadowPages = 0;
  lights.shadowDraws = 0;
  lights.shadowDrawCalls = 0;
  if (!shadows || !store.count) return 0;
  const view = shadowViewpointOf(cam);
  const count = plan.plan(store, view, frame, nowMs);
  const { regions, slices } = plan;
  let flushes = 0,
    lastSlice = -1,
    lastFace = -1;
  for (let region = 0; region < count; region++) {
    const slice = regions.sliceOf(region),
      face = regions.faceOf(region);
    const light = store.light(store.ids[regions.lightOf(region)]);
    if (!light) continue;
    const side = slices.side[slice],
      rows = pageRowsOf(side);
    const x0 = regions.x0Of(region),
      x1 = regions.x1Of(region),
      y0 = regions.y0Of(region),
      y1 = regions.y1Of(region);
    const matrixBase = region * 16;
    const planes = writeFace(
      faceMatrices,
      matrixBase,
      cull ? cull.volumes : null,
      region * SHADOW_CULL_FLOATS,
      light,
      face,
      view,
      side,
      regionRect(rectScratch, rows, x0, x1, y0, y1),
    );
    shadows.writeRegion(region, slice, face, faceMatrices, matrixBase, slices.rects);
    const rect = slice * RECTS_PER_SLICE + face * 3;
    const faceX = slices.rects[rect],
      faceY = slices.rects[rect + 1];
    const scissor = region * 4,
      viewport = region * 3;
    regionScissor[scissor] = faceX + x0 * SHADOW_PAGE;
    regionScissor[scissor + 1] = faceY + y0 * SHADOW_PAGE;
    regionScissor[scissor + 2] = (x1 - x0 + 1) * SHADOW_PAGE;
    regionScissor[scissor + 3] = (y1 - y0 + 1) * SHADOW_PAGE;
    regionViewport[viewport] = faceX;
    regionViewport[viewport + 1] = faceY;
    regionViewport[viewport + 2] = slices.rects[rect + 2];
    // Les régions d'une même face se suivent : un changement de paire tranche/face est une face de
    // plus redessinée, et c'est ce que le profil publie à côté des pages.
    if (slice !== lastSlice || face !== lastFace) {
      lastSlice = slice;
      lastFace = face;
      lights.shadowFaces++;
      if (light.kind === 'directional') lights.sunCascades++;
      shadows.writeSliceInfo(
        slice,
        faceCountOf(LIGHT_KIND[light.kind]),
        Math.tan(planes.halfFov),
        side,
        planes.near,
      );
      flushedSlices[flushes++] = slice;
    }
  }
  if (count) shadows.flushRegions(count);
  if (flushes) shadows.flushSlices(flushedSlices, flushes);
  lights.shadowsUpdated = plan.counts.lights;
  lights.shadowRegions = count;
  lights.shadowPages = regions.pages;
  return count;
}
