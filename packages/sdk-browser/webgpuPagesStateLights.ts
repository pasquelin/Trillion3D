import {
  SCENE_LIGHT_BUFFER_FLOATS,
  createSceneLightStore,
  createShadowPlan,
  type SceneLightStore,
  type ShadowPlan,
} from '../sdk-core/index.ts';
import { MAX_FACES_PER_FRAME, type GpuShadowAtlas } from './gpuShadowAtlas.ts';
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
  /** Lampes du contrat retenues par la dernière image, et tranches d'ombre redessinées. Ce que la
   *  passe a dû écarter se lit sur l'ordonnanceur lui-même (`plan.denied`, `plan.pending`). */
  lightsActive: number;
  shadowsUpdated: number;
  /** Faces planifiées, et dessins indirects réellement encodés par la dernière passe : un par face. */
  shadowFaces: number;
  shadowDraws: number;
  /** Appels de dessin réellement encodés par la passe d'ombres : une remise au fond et un dessin
   *  indirect par face redessinée. C'est le coût par lampe à ombre. */
  shadowDrawCalls: number;
  /** Pourquoi l'atlas d'ombres n'existe pas, quand il n'existe pas. */
  shadowReason: string | null;
  /** La configuration de la première image éclairée par le contrat n'est journalisée qu'une fois. */
  firstFrameLogged: boolean;
}

export function createWebgpuLightState(store?: SceneLightStore): WebgpuLightState {
  return {
    store: store ?? createSceneLightStore(),
    plan: createShadowPlan(),
    buffer: undefined,
    tiles: undefined,
    shadows: undefined,
    cull: undefined,
    spheres: undefined,
    shadowGroups: new Array(MAX_FACES_PER_FRAME).fill(undefined),
    shadowGroupsKey: [],
    uploadedEpoch: 0,
    faceMatrices: new Float32Array(MAX_FACES_PER_FRAME * 16),
    lightsActive: 0,
    shadowsUpdated: 0,
    shadowFaces: 0,
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
