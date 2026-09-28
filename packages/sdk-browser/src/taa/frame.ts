import {
  TAA_SAMPLES,
  jitterViewProjection,
  taaJitter,
  taaStillFrames,
  upscalePhases,
} from './jitter.ts';
import { writeTaaView } from './view.ts';
import { SAMPLED_RANKS } from '../lighting/direct/lightSamplingWgsl.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { AccumulatedImage } from '../lighting/deferred/program.ts';
import type { TemporalAntialiasing } from './temporalAntialiasing.ts';

/** What the temporal pass keeps from one image to the next on the CPU side. */
export interface TaaFrameState {
  /** Jitter rank of the next accumulated image; only advances on those, over `phases`. */
  sample: number;
  /** Jitter phases of the frame's render-to-display ratio (`upscalePhases`): eight at native size. */
  phases: number;
  /** This image's jitter, in the pixels it is drawn in. */
  jitter: Float64Array;
  /** Render view-projection of this image, jitter included: what the raster, shading, blend and
   *  the partition read, decided once at image entry. */
  viewProjection: Float64Array;
  /** View-projection WITHOUT jitter of the last accumulated image: what the history describes. */
  previousViewProjection: Float64Array;
  hasHistory: boolean;
  /** Quiet images accumulated in a row; see `taaStillFrames`. Zero as soon as something moves. */
  stillFrames: number;
  /** Scene revision of the last accumulated image: another one causes poses to be compared. */
  sceneSeen: number;
  /** True when the current image accumulates: rendered with jitter, resolved by the pass. */
  active: boolean;
  /** Rank of a MOVING image, whose lighting is drawn per pixel (`../lighting/direct/lightSamplingWgsl.ts`):
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
    phases: TAA_SAMPLES,
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
  // Switched off, the pass is kept but nothing accumulates (`setWebgpuTemporalAntialiasing`).
  state.active = rt.gpu.temporalWanted && !rt.capture.capturing && rt.run.diagnostic === 'beauty';
  if (!state.active) return;
  // A convergence image remakes the last ordinary image, it does not accumulate it further.
  if (rt.run.textureConverging || rt.feedbackAB?.force) quiet = temporal.replay();
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
  // The jitter is in the pixels the frame is drawn in; its phases follow the ratio to the display.
  const { targetSize, displaySize } = rt.gpu;
  state.phases = upscalePhases(targetSize[0], displaySize[0]);
  taaJitter(state.sample, state.jitter, state.phases);
  jitterViewProjection(
    state.viewProjection,
    cam.viewProjection,
    state.jitter[0],
    state.jitter[1],
    targetSize[0],
    targetSize[1],
  );
}

/** Render matrix of this image: the camera's when the image does not accumulate. */
export function taaRenderMatrix(rt: WebgpuPagesRuntime, cam: EngineCamera): ArrayLike<number> {
  const temporal = rt.gpu.temporal;
  return temporal?.frame.active ? temporal.frame.viewProjection : cam.viewProjection;
}

/**
 * Encodes this image's temporal pass and returns the accumulated image composition must read —
 * `undefined` when the image does not accumulate, and composition reads the lit one. Writes the
 * uniform, updates placement motion, advances the jitter rank and keeps the view-projection without
 * jitter for the next image. With `asIs` false no as-is pixel is in the image, and the flagless
 * resolve reads no flags (OMB-11). A frame drawn below the display is reconstructed to it.
 */
export function encodeTaaPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  current: GPUTextureView,
  asIs = true,
  share?: GPUTextureView,
): AccumulatedImage | undefined {
  const temporal = rt.gpu.temporal,
    { gpu, vis, run } = rt;
  if (!temporal?.frame.active || !gpu.depthView || !gpu.surfaces || !vis.visView || !vis.pageTable)
    return undefined;
  const state = temporal.frame,
    scene = run.gate.revisions.scene;
  if (!state.hasHistory) temporal.motion.reset();
  else temporal.motion.update(cam.eye, state.sceneSeen !== scene);
  const { targetSize, displaySize } = gpu;
  writeTaaView(
    device,
    temporal.uniform,
    state,
    cam,
    targetSize,
    displaySize,
    temporal.motion.moved,
  );
  const { inputs } = temporal;
  inputs.upscale = targetSize[0] !== displaySize[0] || targetSize[1] !== displaySize[1];
  inputs.current = current;
  inputs.depth = gpu.depthView;
  inputs.ids = vis.visView;
  inputs.pages = vis.pageTable;
  inputs.motion = temporal.motion.buffer;
  inputs.flags = asIs ? gpu.surfaces.views()[3] : undefined;
  inputs.share = asIs ? share : undefined;
  const output = temporal.encode(encoder, inputs);
  run.gpuDrawCalls++;
  state.sceneSeen = scene;
  state.previousViewProjection.set(cam.viewProjection);
  state.hasHistory = true;
  state.sample = (state.sample + 1) % state.phases;
  return output;
}

/** History is to be remade: targets reallocated, or size changed. */
export function dropTaaHistory(rt: WebgpuPagesRuntime) {
  forgetTaaHistory(rt.gpu.temporal);
}

/** `temporal`'s history is to be remade, whichever view holds it. */
export function forgetTaaHistory(temporal: TemporalAntialiasing | undefined) {
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

/**
 * True when a quiet image can be held without freezing an accumulation in progress: without
 * temporal antialiasing, switched off, or when it closes a full cycle of quiet images. Read before
 * the image's entry, which a held image never makes: a barrier's convergence image then replays
 * the image the hold shows, to the bit (#26). A view that does not accumulate keeps the count.
 */
export function taaSettled(rt: WebgpuPagesRuntime) {
  const temporal = rt.gpu.temporal;
  if (!temporal || !rt.gpu.temporalWanted) return true;
  return temporal.frame.stillFrames >= taaStillFrames(temporal.frame.phases) - 1;
}
