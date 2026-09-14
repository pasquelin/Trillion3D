import type * as THREE from 'three';
import { uploadSceneLights } from './webgpuPagesStateLights.ts';
import { encodeShadowAtlas, planShadowFaces } from './webgpuPagesEncodeShadows.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Les huit flottants que la passe différée relit : lampes, tuiles, mode, ciel et exposition. */
const directParams = new Float32Array(8);

/**
 * L'éclairage direct d'une image, dans l'ordre : ordonnancement des ombres et écriture des matrices,
 * passe de profondeur dans l'atlas, listes de lampes par tuile, puis les paramètres que la résolution
 * différée relira. Une scène sans lampe du contrat ne lance ni ombres ni listes : elle ne paie rien
 * et l'image sort exactement comme avant.
 */
export function encodeDirectLights(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  camera: THREE.PerspectiveCamera,
  inverseViewProjection: ArrayLike<number>,
) {
  const { lights, gpu } = rt,
    { store, tiles } = lights,
    [width, height] = gpu.targetSize;
  const active = store.count;
  lights.lightsActive = active;
  const environment = store.environment;
  directParams[0] = 0;
  directParams[1] = 0;
  directParams[2] = 0;
  directParams[3] = environment ? 1 : 0;
  directParams[4] = environment ? environment.skyColor[0] : 0;
  directParams[5] = environment ? environment.skyColor[1] : 0;
  directParams[6] = environment ? environment.skyColor[2] : 0;
  directParams[7] = environment ? environment.exposure : 1;
  if (!active || !tiles || !gpu.depthView) return directParams;
  const faces = planShadowFaces(rt, camera);
  uploadSceneLights(device, lights);
  encodeShadowAtlas(rt, device, encoder, faces);
  if (!tiles.ensure(width, height, gpu.depthView)) return directParams;
  tiles.update(inverseViewProjection, width, height, active);
  if (!tiles.encode(encoder)) return directParams;
  const [tilesX, tilesY] = tiles.tileCounts;
  directParams[0] = active;
  directParams[1] = tilesX;
  directParams[2] = tilesY;
  logFirstDirectFrame(rt, tilesX, tilesY, faces);
  return directParams;
}

/** La configuration de la première image éclairée par le contrat, journalisée une seule fois. */
function logFirstDirectFrame(
  rt: WebgpuPagesRuntime,
  tilesX: number,
  tilesY: number,
  faces: number,
) {
  const { lights, diag } = rt;
  if (lights.firstFrameLogged) return;
  lights.firstFrameLogged = true;
  diag.engineDiagnostic('direct-lighting-frame', 'Première image éclairée par le contrat', {
    version: 1,
    lights: lights.lightsActive,
    mode: lights.store.mode,
    tiles: [tilesX, tilesY],
    shadowsUpdated: lights.shadowsUpdated,
    shadowFaces: faces,
    shadowDraws: lights.shadowDraws,
    shadowsDenied: lights.shadowsDenied,
    shadowsPending: lights.shadowsPending,
    atlasCells: lights.shadows ? lights.plan.slices.atlas.occupancy() : null,
    unavailable: lights.shadowReason,
  });
}

/** Vrai dès que l'hôte a déclaré une lampe ou un environnement : le programme du contrat s'impose. */
export function wantsContractLighting(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights;
  return store.count > 0 || !!store.environment;
}

/** Les ressources du contrat que la passe différée lie, ou rien quand elles n'existent pas. */
export function directLightResources(rt: WebgpuPagesRuntime) {
  const { lights } = rt;
  if (!wantsContractLighting(rt)) return {};
  return {
    tiles: lights.tiles?.buffer,
    slices: lights.shadows?.sliceBuffer,
    atlas: lights.shadows?.view,
  };
}
