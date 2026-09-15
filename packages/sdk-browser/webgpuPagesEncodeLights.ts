import type * as THREE from 'three';
import { uploadSceneLights } from './webgpuPagesStateLights.ts';
import { planShadowFaces } from './webgpuPagesEncodeShadows.ts';
import { encodeShadowAtlas } from './webgpuPagesEncodeShadowPass.ts';
import type { DirectLightResources } from './deferredLightingProgram.ts';
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
  directParams[0] = active;
  directParams[1] = tiles.tilesX;
  directParams[2] = tiles.tilesY;
  logFirstDirectFrame(rt);
  return directParams;
}

/** La configuration de la première image éclairée par le contrat, journalisée une seule fois. */
function logFirstDirectFrame(rt: WebgpuPagesRuntime) {
  const { lights, diag } = rt;
  if (lights.firstFrameLogged) return;
  lights.firstFrameLogged = true;
  diag.engineDiagnostic('direct-lighting-frame', 'Première image éclairée par le contrat', {
    version: 1,
    tiles: [lights.tiles?.tilesX ?? 0, lights.tiles?.tilesY ?? 0],
    ...directLightingState(rt),
  });
}

/** L'état de l'éclairage direct, tel que les diagnostics de l'image et du suivi le publient. */
export function directLightingState(rt: WebgpuPagesRuntime) {
  const { lights } = rt;
  return {
    contractLights: lights.lightsActive,
    mode: lights.store.mode,
    shadowsUpdated: lights.shadowsUpdated,
    shadowsReused: lights.plan.reused,
    shadowFaces: lights.shadowFaces,
    shadowDraws: lights.shadowDraws,
    shadowsPending: lights.plan.pending,
    shadowsDenied: lights.plan.denied,
    atlasCells: lights.shadows ? lights.plan.slices.atlas.occupancy() : null,
    unavailable: lights.shadowReason,
  };
}

/** Vrai dès que l'hôte a déclaré une lampe ou un environnement : le programme du contrat s'impose. */
export function wantsContractLighting(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights;
  return store.count > 0 || !!store.environment;
}

const contractResources: DirectLightResources = {};

/** Les ressources du contrat que la passe différée lie, ou rien quand elles n'existent pas.
 *  L'objet est réutilisé d'une image à l'autre : la passe n'en alloue aucun. */
export function directLightResources(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    active = wantsContractLighting(rt);
  contractResources.tiles = active ? lights.tiles?.buffer : undefined;
  contractResources.slices = active ? lights.shadows?.sliceBuffer : undefined;
  contractResources.atlas = active ? lights.shadows?.view : undefined;
  return contractResources;
}
