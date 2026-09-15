import {
  SCENE_LIGHT_BUFFER_FLOATS,
  createSceneLightStore,
  createShadowPlan,
  type SceneLightStore,
  type ShadowPlan,
} from '../sdk-core/index.ts';
import { MAX_SHADOW_REGIONS, type GpuShadowAtlas } from './gpuShadowAtlas.ts';
import type { GpuShadowCull } from './gpuShadowCull.ts';
import type { GpuLightTiles } from './gpuLightTiles.ts';

/**
 * L'état de l'éclairage direct du contrat : le magasin de lampes (partagé avec l'hôte), les listes
 * par tuile, l'atlas d'ombres et l'ordonnanceur. Les tampons de matrices de face sont alloués une
 * fois pour le budget d'une image ; une image n'alloue rien.
 */
export interface WebgpuLightState {
  store: SceneLightStore;
  plan: ShadowPlan;
  buffer: GPUBuffer | undefined;
  tiles: GpuLightTiles | undefined;
  shadows: GpuShadowAtlas | undefined;
  /** Le rejet par face et les sphères monde qu'il lit ; absents tant que l'atlas n'existe pas. */
  cull: GpuShadowCull | undefined;
  spheres: { buffer: GPUBuffer; packed: Float32Array<ArrayBuffer>; rows: number } | undefined;
  /** Groupes de liaison des faces d'ombre, et les ressources sur lesquelles ils ont été bâtis. */
  shadowGroups: Array<GPUBindGroup | undefined>;
  shadowGroupsKey: unknown[];
  /** Révision du magasin déjà poussée au GPU : une image sans changement n'écrit rien. */
  uploadedEpoch: number;
  /** Matrices des faces de l'image, une par face remise à jour. */
  faceMatrices: Float32Array;
  /** Lampes du contrat retenues par la dernière image, et lampes dont une carte a été redessinée.
   *  La file d'attente et son retard se lisent sur l'ordonnanceur (`plan.counts`). */
  lightsActive: number;
  shadowsUpdated: number;
  /** Faces réellement touchées par la dernière image, toutes régions confondues. */
  shadowFaces: number;
  /** Régions redessinées et pages qu'elles couvrent : l'unité de travail et celle du budget. */
  shadowRegions: number;
  shadowPages: number;
  /** Pages redessinées par image, par rang d'image : le chronomètre GPU revient avec du retard et
   *  doit retrouver le travail de l'image qu'il décrit pour en déduire le coût d'une page. */
  pagesByFrame: Uint32Array;
  /** Part de ces faces qui sont des cascades de soleil : le coût du soleil, séparé des ponctuelles. */
  sunCascades: number;
  shadowDraws: number;
  /** Appels de dessin réellement encodés par la passe d'ombres : une remise au fond et un dessin
   *  indirect par face redessinée. C'est le coût par lampe à ombre. */
  shadowDrawCalls: number;
  /** Pourquoi l'atlas d'ombres n'existe pas, quand il n'existe pas. */
  shadowReason: string | null;
  /** La configuration de la première image éclairée par le contrat n'est journalisée qu'une fois. */
  firstFrameLogged: boolean;
}

/** Images gardées dans l'anneau des pages : bien au-delà du retard d'un relevé d'horodatage. */
export const PAGES_RING = 64;

export function createWebgpuLightState(store?: SceneLightStore): WebgpuLightState {
  return {
    store: store ?? createSceneLightStore(),
    plan: createShadowPlan(MAX_SHADOW_REGIONS),
    buffer: undefined,
    tiles: undefined,
    shadows: undefined,
    cull: undefined,
    spheres: undefined,
    shadowGroups: new Array(MAX_SHADOW_REGIONS).fill(undefined),
    shadowGroupsKey: [],
    uploadedEpoch: 0,
    faceMatrices: new Float32Array(MAX_SHADOW_REGIONS * 16),
    lightsActive: 0,
    shadowsUpdated: 0,
    shadowFaces: 0,
    shadowRegions: 0,
    shadowPages: 0,
    pagesByFrame: new Uint32Array(PAGES_RING),
    sunCascades: 0,
    shadowDraws: 0,
    shadowDrawCalls: 0,
    shadowReason: null,
    firstFrameLogged: false,
  };
}

/** Le tampon de lampes du contrat, à taille fixe : jamais réalloué, jamais indexé au-delà. */
export function createSceneLightContractBuffer(device: GPUDevice) {
  return device.createBuffer({
    label: 'WG direct lights v1',
    size: SCENE_LIGHT_BUFFER_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

/** Pousse le magasin au GPU si et seulement si sa révision a changé depuis la dernière image. */
export function uploadSceneLights(device: GPUDevice, lights: WebgpuLightState) {
  const { store, buffer } = lights;
  if (!buffer) return false;
  if (lights.uploadedEpoch === store.epoch) return false;
  lights.uploadedEpoch = store.epoch;
  device.queue.writeBuffer(buffer, 0, store.packed);
  return true;
}
