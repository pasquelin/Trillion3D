import type * as THREE from 'three';
import { PAGES_RING, uploadSceneLights } from './webgpuPagesStateLights.ts';
import { planShadowRegions } from './webgpuPagesEncodeShadows.ts';
import { encodeShadowAtlas } from './webgpuPagesEncodeShadowPass.ts';
import type { DirectLightResources } from './deferredLightingProgram.ts';
import { ensureBounce } from './webgpuPagesPrepareBounce.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Les quatre flottants que la passe différée relit : lampes, tuiles en X et Y, exposition. */
const directParams = new Float32Array(4);
/** La position monde de la caméra, réutilisée d'une image à l'autre : le rebond n'alloue rien. */
const viewpoint = new Float64Array(3);

/**
 * L'éclairage direct d'une image, dans l'ordre : ordonnancement des ombres et écriture des matrices,
 * passe de profondeur dans l'atlas, listes de lampes par tuile, puis les paramètres que la résolution
 * différée relira. Une scène sans lampe déclarée ne lance ni ombres ni listes : elle ne paie rien,
 * et la vue sans éclairage sort son albédo brut.
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
  directParams.fill(0);
  // L'exposition n'est pas une lumière : elle règle la conversion de la radiance en image, et ne
  // peut rien éclairer que les lampes déclarées n'éclairent déjà.
  directParams[3] = environment ? environment.exposure : 1;
  // La vue sans éclairage ne lit ni liste de lampes ni atlas : elle n'en fait donc encoder aucun.
  if (!active || store.unlit) return directParams;
  const frame = rt.run.frame;
  const regions = planShadowRegions(rt, camera, frame, performance.now());
  // Le chronomètre de la passe revient avec du retard : l'image doit laisser derrière elle le
  // nombre de pages qu'elle a redessinées, sinon le relevé ne saurait pas ce qu'il chiffre.
  lights.pagesByFrame[frame % PAGES_RING] = lights.shadowPages;
  // Le tampon part au GPU avant les listes par tuile : la passe de mélange le lit directement, sans
  // tuile, et doit rester éclairée même sur un appareil qui n'a pas pu gréer les listes.
  uploadSceneLights(device, lights);
  encodeBounce(rt, device, encoder, active, camera);
  encodeShadowAtlas(rt, device, encoder, regions);
  if (!tiles || !gpu.depthView) return directParams;
  if (!tiles.ensure(width, height, gpu.depthView)) return directParams;
  tiles.update(inverseViewProjection, width, height, active);
  if (!tiles.encode(encoder)) return directParams;
  directParams[0] = active;
  directParams[1] = tiles.tilesX;
  directParams[2] = tiles.tilesY;
  logFirstDirectFrame(rt);
  return directParams;
}

/**
 * Un lot de sondes d'irradiance, quand il y a du travail. La grille relit le tampon de lampes qui
 * vient d'être poussé, donc le rebond suit la lampe qui bouge sans une image de retard de plus. Une
 * scène dont rien n'a changé et dont la grille est convergée n'encode rien du tout : l'étape
 * « Rebond » vaut alors « non mesuré », jamais zéro.
 */
function encodeBounce(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  active: number,
  camera: THREE.PerspectiveCamera,
) {
  const { bounce, lights } = rt;
  // Une lampe existe : c'est le signal qui déclenche la lecture du proxy résident, une seule fois.
  ensureBounce(rt, device);
  const probes = bounce.probes;
  bounce.probesUpdated = 0;
  bounce.raysLaunched = 0;
  bounce.encoded = false;
  // La vue de diagnostic d'irradiance sort des valeurs brutes : l'application du rebond le lit
  // dans l'uniforme de la grille, et la composition saute ACES et sRGB.
  const irradiance = lights.store.lightingView === 'bounce';
  rt.gpu.deferred?.setRawOutput(irradiance);
  if (!probes) return;
  probes.setIrradianceView(irradiance);
  // La révision du magasin monte dès qu'une lampe est ajoutée, réglée ou retirée : c'est le seul
  // signal dont la grille a besoin pour repartir, et il ne coûte aucune lecture.
  if (bounce.lightEpoch !== lights.store.epoch) {
    bounce.lightEpoch = lights.store.epoch;
    probes.restart();
  }
  // La position monde de la caméra, lue dans sa matrice : les cascades s'y recentrent par pas de
  // maille. Aucune allocation, et rien d'autre de la caméra n'entre dans le rebond — ni sa
  // direction, ni son tronc de vue : une caméra qui pivote ne périmerait alors rien de bon.
  const world = camera.matrixWorld.elements;
  viewpoint[0] = world[12];
  viewpoint[1] = world[13];
  viewpoint[2] = world[14];
  bounce.encoded = probes.encode(encoder, active, viewpoint);
  bounce.probesUpdated = probes.lastProbes;
  bounce.raysLaunched = probes.lastRays;
}

/** L'état du rebond, tel que les diagnostics de l'image et le profil par étape le publient. */
export function bounceState(rt: WebgpuPagesRuntime) {
  const { bounce } = rt,
    probes = bounce.probes;
  return {
    probes: probes?.cascades.probes ?? null,
    probesUpdated: bounce.probesUpdated,
    rays: bounce.raysLaunched,
    budgetLoad: probes?.budget.load ?? null,
    budgetLastMs: probes?.budget.lastMs ?? null,
    converged: probes ? !probes.working : null,
    unavailable: bounce.reason,
  };
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
    view: lights.store.lightingView,
    unlit: lights.store.unlit,
    shadowsUpdated: lights.shadowsUpdated,
    sunShadowsUpdated: lights.plan.counts.sunLights,
    shadowsReused: lights.plan.counts.reused,
    shadowFaces: lights.shadowFaces,
    sunCascades: lights.sunCascades,
    shadowDraws: lights.shadowDraws,
    shadowRegions: lights.shadowRegions,
    shadowPagesDrawn: lights.shadowPages,
    shadowPagesInvalidated: lights.plan.counts.invalidatedPages,
    shadowPagesPending: lights.plan.counts.pendingPages,
    shadowWaitMs: lights.plan.counts.waitedMs,
    shadowWaitFrames: lights.plan.counts.waitedFrames,
    shadowBudgetMs: lights.plan.budget.budgetMs,
    shadowMsPerPage: lights.plan.budget.msPerPage,
    shadowsDenied: lights.plan.counts.denied,
    atlasCells: lights.shadows ? lights.plan.slices.atlas.occupancy() : null,
    unavailable: lights.shadowReason,
  };
}

/**
 * Vrai quand l'image doit être éclairée par les lampes déclarées. Faux dans la vue sans éclairage,
 * qu'elle soit demandée par l'hôte ou qu'elle vienne du défaut d'une scène sans lampe : dans les
 * deux cas le programme du contrat n'a rien à faire, et l'albédo brut sort tel quel.
 */
export function wantsContractLighting(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights;
  return store.count > 0 && !store.unlit;
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
  // La grille n'est liée que si elle existe : sans elle, la passe différée compile et lie le
  // programme du contrat seul, exactement celui d'avant ce lot.
  const bounce = active ? rt.bounce.probes : undefined;
  contractResources.bounceGrid = bounce?.uniform;
  contractResources.probes = bounce?.probes;
  return contractResources;
}
