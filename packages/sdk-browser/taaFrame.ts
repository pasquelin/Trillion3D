import { invertMatrix4, matrixAtRenderOrigin } from '../sdk-core/index.ts';
import { TAA_SAMPLES, TAA_STILL_FRAMES, jitterViewProjection, taaJitter } from './taaJitter.ts';
import { TAA_WEIGHTS, taaWeightTable } from './taaWeights.ts';
import type { EngineCamera } from './cameraWorld.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Ce que la passe temporelle garde d'une image à l'autre côté processeur. */
export interface TaaFrameState {
  /** Rang de gigue de la prochaine image accumulée ; n'avance que sur celles-là. */
  sample: number;
  jitter: Float64Array;
  /** La vue-projection de rendu de cette image, gigue comprise : ce que le raster, l'ombrage, le
   *  mélange et la partition lisent, décidé une fois à l'entrée d'image. */
  viewProjection: Float64Array;
  /** La vue-projection SANS gigue de la dernière image accumulée : ce que l'historique décrit. */
  previousViewProjection: Float64Array;
  hasHistory: boolean;
  /** Images calmes accumulées d'affilée ; voir `TAA_STILL_FRAMES`. Zéro dès que quelque chose bouge. */
  stillFrames: number;
  /** La révision de scène de la dernière image accumulée : une autre fait comparer les poses. */
  sceneSeen: number;
  /** Vrai quand l'image en cours accumule : rendue avec gigue, résolue par la passe. */
  active: boolean;
}

/** Ce qu'une image de convergence rejoue de la dernière image ordinaire : voir `checkpoint`. */
export function createTaaCheckpoint() {
  return {
    read: 0,
    sample: 0,
    stillFrames: 0,
    hasHistory: false,
    sceneSeen: -1,
    quiet: false,
    previousViewProjection: new Float64Array(16),
  };
}

export function createTaaFrameState(): TaaFrameState {
  return {
    sample: 0,
    jitter: new Float64Array(2),
    viewProjection: new Float64Array(16),
    previousViewProjection: new Float64Array(16),
    hasHistory: false,
    stillFrames: 0,
    sceneSeen: -1,
    active: false,
  };
}

/**
 * L'entrée d'image de la passe, appelée une fois par image, là où le calme de l'image est connu.
 * Une capture de surfaces et une vue de diagnostic n'accumulent pas : elles rendent au centre du
 * pixel, comme leur contrat le dit. Sinon : à la première image calme l'historique est abandonné
 * et la gigue repart en phase zéro ; la gigue du rang courant est posée sur la vue-projection de
 * rendu, et la caméra du moteur n'est pas touchée — la sélection lit toujours ses propres plans.
 */
export function beginTaaFrame(rt: WebgpuPagesRuntime, cam: EngineCamera, quiet: boolean) {
  const temporal = rt.gpu.temporal;
  if (!temporal) return;
  const state = temporal.frame;
  state.active = !rt.capture.secondaryCamera && rt.run.diagnostic === 'beauty';
  if (!state.active) return;
  // Une image de convergence refait la dernière image ordinaire, elle ne l'accumule pas de plus.
  if (rt.run.textureConverging) quiet = temporal.replay();
  else temporal.checkpoint(quiet);
  if (!quiet) state.stillFrames = 0;
  else if (state.stillFrames++ === 0) {
    state.hasHistory = false;
    state.sample = 0;
  }
  const [width, height] = rt.gpu.targetSize;
  taaJitter(state.sample, state.jitter);
  jitterViewProjection(
    state.viewProjection,
    cam.viewProjection,
    state.jitter[0],
    state.jitter[1],
    width,
    height,
  );
}

/** La matrice de rendu de cette image : celle de la caméra quand l'image n'accumule pas. */
export function taaRenderMatrix(rt: WebgpuPagesRuntime, cam: EngineCamera): ArrayLike<number> {
  const temporal = rt.gpu.temporal;
  return temporal?.frame.active ? temporal.frame.viewProjection : cam.viewProjection;
}

const anchored = new Float64Array(16),
  packed = new Float32Array(40 + TAA_WEIGHTS),
  /** Les poids du filtre pour chacun des huit rangs de gigue : ils ne dépendent que d'elle. */
  weights = taaWeightTable();

/**
 * Encode la passe temporelle de cette image et rend la vue que la composition doit lire — celle de
 * l'image éclairée quand l'image n'accumule pas. Écrit l'uniforme, met à jour les mouvements de
 * placements, avance le rang de gigue et retient la vue-projection sans gigue pour l'image suivante.
 */
export function encodeTaaPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  current: GPUTextureView,
): GPUTextureView {
  const temporal = rt.gpu.temporal,
    { gpu, vis, run } = rt;
  if (!temporal?.frame.active || !gpu.depthView || !vis.visView || !vis.pageTable) return current;
  const state = temporal.frame,
    scene = run.gate.revisions.scene;
  if (!state.hasHistory) temporal.motion.reset();
  else temporal.motion.update(cam.eye, state.sceneSeen !== scene);
  const [width, height] = gpu.targetSize;
  matrixAtRenderOrigin(packed, state.previousViewProjection, cam.eye, 0);
  // L'inverse de la vue-projection SANS gigue : le pixel reprojeté est son centre non décalé, avec
  // la profondeur lue à l'échantillon décalé. À caméra fixe, l'historique est ainsi relu exactement
  // sur son texel — relu à la gigue près, il serait rééchantillonné en bilinéaire à chaque image et
  // s'adoucirait sans fin.
  matrixAtRenderOrigin(anchored, cam.viewProjection, cam.eye);
  packed.set(invertMatrix4(anchored, anchored), 16);
  packed[32] = width;
  packed[33] = height;
  packed[34] = 1 / width;
  packed[35] = 1 / height;
  // Part de l'image courante : 1/k à la k-ième image calme, un huitième en mouvement.
  packed[36] = state.stillFrames > 0 ? 1 / state.stillFrames : 1 / TAA_SAMPLES;
  packed[37] = state.hasHistory ? 1 : 0;
  packed[38] = temporal.motion.moved ? 1 : 0;
  packed[39] = 0;
  packed.set(weights[state.sample], 40);
  device.queue.writeBuffer(temporal.uniform, 0, packed);
  const { inputs } = temporal;
  inputs.current = current;
  inputs.depth = gpu.depthView;
  inputs.ids = vis.visView;
  inputs.pages = vis.pageTable;
  inputs.motion = temporal.motion.buffer;
  const output = temporal.encode(encoder, inputs);
  run.gpuDrawCalls++;
  state.sceneSeen = scene;
  state.previousViewProjection.set(cam.viewProjection);
  state.hasHistory = true;
  state.sample = (state.sample + 1) % TAA_SAMPLES;
  return output;
}

/** L'historique est à refaire : cibles réallouées, ou taille changée. */
export function dropTaaHistory(rt: WebgpuPagesRuntime) {
  const temporal = rt.gpu.temporal;
  if (!temporal) return;
  temporal.frame.hasHistory = false;
  temporal.frame.stillFrames = 0;
}

/** Vrai quand l'image peut être tenue sans figer une accumulation en cours : sans antialiasing
 *  temporel, ou après un plein cycle d'images calmes. */
export function taaSettled(rt: WebgpuPagesRuntime) {
  const temporal = rt.gpu.temporal;
  return !temporal || temporal.frame.stillFrames >= TAA_STILL_FRAMES;
}
