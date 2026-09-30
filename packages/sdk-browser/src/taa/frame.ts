import { jitterViewProjection, taaJitter, taaStillFrames, upscalePhases } from './jitter.ts';
import { writeTaaView } from './view.ts';
import { SAMPLED_RANKS } from '../lighting/direct/lightSamplingWgsl.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { AccumulatedImage } from '../lighting/deferred/program.ts';
import type { TemporalAntialiasing } from './temporalAntialiasing.ts';
import { writtenFilter } from '../webgpu/blend/displayFilter.ts';
import { drawFrameAt, imageScale } from '../webgpu/pages/state/renderScale.ts';

/**
 * Image entry of the pass, called once per image, where the quiet of the image is known. A
 * surface capture and a diagnostic view do not accumulate: they render at the centre of the
 * pixel, as their contract says. Otherwise: at the first quiet image the history is dropped and
 * jitter restarts at phase zero; the current rank's jitter is set on the render view-projection,
 * and the engine camera is not touched — selection always reads its own planes.
 */
export function beginTaaFrame(rt: WebgpuPagesRuntime, cam: EngineCamera, quiet: boolean) {
  const temporal = rt.gpu.temporal;
  // Switched off, the pass is kept but nothing accumulates (`setWebgpuTemporalAntialiasing`).
  const active = rt.gpu.temporalWanted && !rt.capture.capturing && rt.run.diagnostic === 'beauty';
  if (temporal) temporal.frame.active = active;
  if (!temporal || !active) return drawFrameAt(rt, 1);
  const state = temporal.frame;
  // A convergence image remakes the last ordinary image, at its scale; it does not accumulate. A
  // capture's barrier makes resident what its still image will read: at that image's scale, one
  // jitter phase after another (`stillPhase`), whatever the path before it (#1016).
  const converging = rt.run.textureConverging || !!rt.feedbackAB?.force;
  if (converging) {
    quiet = temporal.replay();
    if (state.stillPhase !== null) state.scale = imageScale(rt, true);
  } else {
    // A moving image draws its lights from a rank of its own; a still one shades them all, and
    // so does a moving one with no history yet — nothing would average its draws.
    state.sampledRank = quiet || !state.hasHistory ? 0 : (rt.run.frame % SAMPLED_RANKS) + 1;
    state.scale = imageScale(rt, quiet);
    temporal.checkpoint(quiet);
  }
  drawFrameAt(rt, state.scale, !quiet);
  if (!quiet) state.stillFrames = 0;
  else if (state.stillFrames++ === 0) {
    state.hasHistory = false;
    state.sample = 0;
  }
  // The jitter is in the pixels the frame is drawn in; its phases follow the ratio to the display.
  const { targetSize, displaySize } = rt.gpu;
  state.phases = upscalePhases(targetSize[0], displaySize[0]);
  const offset = converging ? (state.stillPhase ?? 0) : 0;
  taaJitter(state.sample + offset, state.jitter, state.phases);
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
 * Encodes this image's temporal pass and its display layers; returns the accumulated image
 * composition reads, `undefined` when none. Writes the uniform, updates motion, advances the
 * jitter, keeps the unjittered view-projection; `asIs` false reads no flags (OMB-11), and a frame
 * drawn below the display is reconstructed to it. `share`, seeded when blends or particles draw,
 * holds the as-is share and the reactive value the blends, particles and water wrote
 * (`../lighting/deferred/asIsShare.ts`), which shortens a moving pixel's history.
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
  const pool = gpu.cache?.buffer;
  if (!temporal?.frame.active || !gpu.depthView || !gpu.surfaces || !vis.visView || !vis.pageTable)
    return undefined;
  if (!pool || !vis.concatPos || !vis.concatUv) return undefined;
  const state = temporal.frame,
    scene = run.gate.revisions.scene;
  if (!state.hasHistory) temporal.motion.reset();
  else temporal.motion.update(cam.eye, state.sceneSeen !== scene);
  const { targetSize, displaySize } = gpu;
  const { inputs, filterHistory } = temporal;
  inputs.filter = writtenFilter(gpu.displayFilter); // `displayFilter.ts`
  writeTaaView(
    device,
    temporal.uniform,
    state,
    cam,
    targetSize,
    displaySize,
    temporal.motion.moved,
    !!inputs.filter && filterHistory.written,
    !!vis.deformationCompute,
  );
  inputs.upscale = targetSize[0] !== displaySize[0] || targetSize[1] !== displaySize[1];
  inputs.current = current;
  inputs.depth = gpu.depthView;
  inputs.ids = vis.visView;
  inputs.pages = vis.pageTable;
  inputs.motion = temporal.motion.buffer;
  inputs.pool = pool;
  inputs.positions = vis.concatPos;
  inputs.uvs = vis.concatUv;
  inputs.flags = asIs ? gpu.surfaces.views()[3] : undefined;
  inputs.share = asIs ? share : undefined;
  inputs.reactive = share;
  const output = temporal.encode(encoder, inputs);
  if (inputs.filter) gpu.targetBytes += filterHistory.uncounted();
  run.gpuDrawCalls++;
  state.sceneSeen = scene;
  state.previousViewProjection.set(cam.viewProjection);
  state.hasHistory = true;
  state.sample = (state.sample + 1) % state.phases;
  return output;
}

/** A capture's barrier (`settlePose`) asks its convergence images for the still image's jitter
 *  phases in turn: `phase` after the replayed one, or `null` once it ends. */
export function convergeStillPhase(rt: WebgpuPagesRuntime, phase: number | null) {
  if (rt.gpu.temporal) rt.gpu.temporal.frame.stillPhase = phase;
}

/** Jitter phases a still image averages: one without temporal accumulation. */
export const taaPhaseCount = (rt: WebgpuPagesRuntime) =>
  rt.gpu.temporal?.frame.active ? rt.gpu.temporal.frame.phases : 1;

/** A tile or a shadow page that lands on a still image changes the raster in the middle of its
 *  average: the uniform average restarts on it, from phase zero at the next image, as a barrier's
 *  landing does (`mustRestartTaaAfterSettle`, #1016). */
export function restartTaaOnLanding(rt: WebgpuPagesRuntime, landed: number) {
  const temporal = rt.gpu.temporal;
  if (landed > 0 && temporal?.frame.active && temporal.frame.stillFrames > 0)
    forgetTaaHistory(temporal);
}

/** The shadow pages the GPU drew itself since the last call, known a snapshot late
 *  (`mirror.drawn`): they land as the host's do, else a shadow drawn at rest stays diluted in the
 *  still average, faint (#1344). */
export function gpuShadowPagesLanded(rt: WebgpuPagesRuntime) {
  const drawn = rt.lights?.plan.gpu.drawn ?? 0,
    seen = gpuDrawnSeen.get(rt) ?? drawn;
  gpuDrawnSeen.set(rt, drawn);
  return drawn - seen;
}
/** The GPU's page listings each runtime last counted (`gpuShadowPagesLanded`). */
const gpuDrawnSeen = new WeakMap<WebgpuPagesRuntime, number>();

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

/** Rank of this image among those whose lighting is SAMPLED (moving, on a history that averages
 *  its draws), or zero: a still image, or one nothing averages, shades every light. */
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
