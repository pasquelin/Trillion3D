import { invertMatrix4, matrixAtRenderOrigin } from '../sdk-core/src/index.ts';
import { TAA_SAMPLES, TAA_STILL_FRAMES, jitterViewProjection, taaJitter } from './taaJitter.ts';
import { TAA_WEIGHTS, taaWeightTable } from './taaWeights.ts';
import { SAMPLED_RANKS } from './directLightSamplingWgsl.ts';
import type { EngineCamera } from './cameraWorld.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** What the temporal pass keeps from one image to the next on the CPU side. */
export interface TaaFrameState {
  /** Jitter rank of the next accumulated image; only advances on those. */
  sample: number;
  jitter: Float64Array;
  /** Render view-projection of this image, jitter included: what the raster, shading, blend and
   *  the partition read, decided once at image entry. */
  viewProjection: Float64Array;
  /** View-projection WITHOUT jitter of the last accumulated image: what the history describes. */
  previousViewProjection: Float64Array;
  hasHistory: boolean;
  /** Quiet images accumulated in a row; see `TAA_STILL_FRAMES`. Zero as soon as something moves. */
  stillFrames: number;
  /** Scene revision of the last accumulated image: another one causes poses to be compared. */
  sceneSeen: number;
  /** True when the current image accumulates: rendered with jitter, resolved by the pass. */
  active: boolean;
  /** Rank of a MOVING image, whose lighting is drawn per pixel (`directLightSamplingWgsl.ts`):
   *  bounded, different from one to the next, replayed with the image. Zero when still. */
  sampledRank: number;
}

/** What a convergence image replays of the last ordinary image: see `checkpoint`. */
export function createTaaCheckpoint() {
  return {
    read: 0,
    sample: 0,
    stillFrames: 0,
    hasHistory: false,
    sceneSeen: -1,
    quiet: false,
    sampledRank: 0,
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
    sampledRank: 0,
  };
}

/**
 * Image entry of the pass, called once per image, where the quiet of the image is known. A
 * surface capture and a diagnostic view do not accumulate: they render at the centre of the
 * pixel, as their contract says. Otherwise: at the first quiet image the history is dropped and
 * jitter restarts at phase zero; the current rank's jitter is set on the render view-projection,
 * and the engine camera is not touched — selection always reads its own planes.
 */
export function beginTaaFrame(rt: WebgpuPagesRuntime, cam: EngineCamera, quiet: boolean) {
  const temporal = rt.gpu.temporal;
  if (!temporal) return;
  const state = temporal.frame;
  state.active = !rt.capture.capturing && rt.run.diagnostic === 'beauty';
  if (!state.active) return;
  // A convergence image remakes the last ordinary image, it does not accumulate it further.
  if (rt.run.textureConverging) quiet = temporal.replay();
  else {
    // A moving image draws its lights from a rank of its own; a still one shades them all, and
    // so does a moving one with no history yet — nothing would average its draws.
    state.sampledRank = quiet || !state.hasHistory ? 0 : (rt.run.frame % SAMPLED_RANKS) + 1;
    temporal.checkpoint(quiet);
  }
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

/** Render matrix of this image: the camera's when the image does not accumulate. */
export function taaRenderMatrix(rt: WebgpuPagesRuntime, cam: EngineCamera): ArrayLike<number> {
  const temporal = rt.gpu.temporal;
  return temporal?.frame.active ? temporal.frame.viewProjection : cam.viewProjection;
}

const anchored = new Float64Array(16),
  packed = new Float32Array(40 + TAA_WEIGHTS),
  /** Filter weights for each of the eight jitter ranks: they depend only on it. */
  weights = taaWeightTable();

/**
 * Encodes this image's temporal pass and returns the view composition must read — that of the lit
 * image when the image does not accumulate. Writes the uniform, updates placement motion, advances
 * the jitter rank and keeps the view-projection without jitter for the next image.
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
  // Inverse of the view-projection WITHOUT jitter: the reprojected pixel is its unshifted centre,
  // with the depth read at the shifted sample. At a fixed camera, history is thus re-read exactly
  // on its texel — re-read to the jitter, it would be resampled bilinearly every image and would
  // soften without end.
  matrixAtRenderOrigin(anchored, cam.viewProjection, cam.eye);
  packed.set(invertMatrix4(anchored, anchored), 16);
  packed[32] = width;
  packed[33] = height;
  packed[34] = 1 / width;
  packed[35] = 1 / height;
  // Share of the current image: 1/k at the k-th quiet image, one eighth in motion.
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

/** History is to be remade: targets reallocated, or size changed. */
export function dropTaaHistory(rt: WebgpuPagesRuntime) {
  const temporal = rt.gpu.temporal;
  if (!temporal) return;
  temporal.frame.hasHistory = false;
  temporal.frame.stillFrames = 0;
}

/**
 * Rank of this image among those whose lighting is SAMPLED — a moving image that
 * accumulates on a history, which averages its draws —, or zero: a still image shades every
 * light and converges to the exact sum, and an image nothing averages must never be noisy.
 */
export function taaSampledRank(rt: WebgpuPagesRuntime) {
  const temporal = rt.gpu.temporal;
  return temporal?.frame.active ? temporal.frame.sampledRank : 0;
}

/** True when the image can be held without freezing an accumulation in progress: without
 *  temporal antialiasing, or after a full cycle of quiet images. */
export function taaSettled(rt: WebgpuPagesRuntime) {
  const temporal = rt.gpu.temporal;
  return !temporal || temporal.frame.stillFrames >= TAA_STILL_FRAMES;
}
