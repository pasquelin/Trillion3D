import { jitterViewProjection, taaJitter, taaStillFrames, upscalePhases } from './jitter.ts';
import { writeTaaView } from './view.ts';
import { SAMPLED_RANKS } from '../lighting/direct/lightSamplingWgsl.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { AccumulatedImage } from '../lighting/deferred/program.ts';
import { writtenFilter } from '../webgpu/blend/displayFilter.ts';
import { drawFrameAt } from '../webgpu/pages/state/renderScale.ts';
import { renderExtent } from '../frame/renderScaleOption.ts';
import { restartTaaAverage, restartTaaOnLanding, restartTaaOnShadowLanding } from './landing.ts';
import {
  decideComposedMotion,
  MOTION_KEEP,
  MOTION_RESET,
  MOTION_SCAN,
} from '../placement/composedMotion.ts';

/**
 * Image entry of the pass, called once per image, where the quiet of the image is known. A
 * surface capture and a diagnostic view do not accumulate: they render at the centre of the
 * pixel, as their contract says. Otherwise: at the first quiet image the history is dropped and
 * jitter restarts at phase zero; the current rank's jitter is set on the render view-projection,
 * selection always reads the engine camera's own planes.
 */
export function beginTaaFrame(rt: WebgpuPagesRuntime, cam: EngineCamera, quiet: boolean) {
  const temporal = rt.gpu.temporal;
  // Switched off, the pass is kept but nothing accumulates (`setWebgpuTemporalAntialiasing`).
  const active = rt.gpu.temporalWanted && !rt.capture.capturing && rt.run.diagnostic === 'beauty';
  if (temporal) temporal.frame.active = active;
  if (!temporal || !active) return drawFrameAt(rt, 1);
  const state = temporal.frame;
  const revision = rt.run.gate.temporalRevision;
  const discontinuity = revision !== undefined && revision !== state.viewSeen;
  // A convergence image remakes the last ordinary image, at its scale; it does not accumulate. A
  // capture's barrier makes resident what its still image will read: at that image's scale, one
  // jitter phase after another (`stillPhase`), whatever the path before it (#1016).
  const converging = rt.run.textureConverging || !!rt.feedbackAB?.force;
  if (converging) quiet = temporal.replay();
  // A view cut drops the history: after the replay, which brings back the checkpoint's own.
  if (discontinuity) {
    restartTaaAverage(state);
    state.viewSeen = revision;
  }
  if (converging) {
    if (state.stillPhase !== null) state.scale = rt.scale.wanted();
  } else {
    // A moving image draws its lights from a rank of its own; a still one shades them all, and
    // so does a moving one with no history yet — nothing would average its draws.
    state.sampledRank = quiet || !state.hasHistory ? 0 : (rt.run.frame % SAMPLED_RANKS) + 1;
    // A still image is drawn at the controller's scale like a moving one, the frame's budget, in
    // targets made at the bounds' maximum (`allocated`): the resolve rebuilds the display's detail
    // from its jitter phases (`upscaleWgsl.ts`), averaged uniformly over their whole cycles before
    // the hold (`taaSettled`). The average is of one drawn size, its phases and jitter grid: the
    // controller changing it, which still images only lower (#1343), restarts it at the new one.
    const scale = rt.scale.wanted(),
      { displaySize } = rt.gpu;
    if (
      quiet &&
      (renderExtent(displaySize[0], scale) !== renderExtent(displaySize[0], state.scale) ||
        renderExtent(displaySize[1], scale) !== renderExtent(displaySize[1], state.scale))
    )
      restartTaaAverage(state);
    state.scale = scale;
    temporal.checkpoint(quiet);
  }
  drawFrameAt(rt, state.scale, !converging, quiet);
  if (!quiet) state.stillFrames = 0;
  else if (state.stillFrames++ === 0) {
    state.hasHistory = false;
    state.sample = 0;
  }
  // The jitter is in the pixels the frame is drawn in; its phases follow the ratio to the display.
  const { targetSize, displaySize } = rt.gpu;
  state.phases = upscalePhases(targetSize[0], displaySize[0]);
  // An image its still average still needs is the image arriving (`taaArrivals`).
  if (quiet && !converging && state.stillFrames <= taaStillFrames(state.phases)) state.stillDrawn++;
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
  restartTaaOnShadowLanding(rt);
  const state = temporal.frame,
    scene = run.gate.revisions.scene;
  const scan = state.sceneSeen !== scene;
  if (!state.hasHistory) temporal.motion.reset();
  else temporal.motion.update(cam.eye, scan);
  // The linked placements' motion, which the GPU composes, follows the same decision.
  const linked = !state.hasHistory ? MOTION_RESET : scan ? MOTION_SCAN : MOTION_KEEP;
  decideComposedMotion(rt, device, cam.eye, linked);
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
    temporal.motion.moved || !!rt.compose?.moving,
    !!inputs.filter && filterHistory.written,
    !!vis.deformationCompute,
    rt.lights.store?.environment?.exposure,
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
  state.previousEye.set(cam.eye);
  state.hasHistory = true;
  state.sample = (state.sample + 1) % state.phases;
  state.stochasticSample++;
  return output;
}

/** A capture's barrier (`settlePose`) asks its convergence images for the still image's jitter
 *  phases in turn: `phase` after the replayed one, or `null` once it ends. */
export function convergeStillPhase(rt: WebgpuPagesRuntime, phase: number | null) {
  if (rt.gpu.temporal) rt.gpu.temporal.frame.stillPhase = phase;
}

/** Quiet images drawn so far into still averages not yet whole (`stillDrawn`): the image still
 *  arriving, as a page landing is, so the interactive loop never pauses before it holds (#836). */
export const taaArrivals = (rt: WebgpuPagesRuntime) => rt.gpu.temporal?.frame.stillDrawn ?? 0;

/** Jitter phases a still image averages: one without temporal accumulation. */
export const taaPhaseCount = (rt: WebgpuPagesRuntime) =>
  rt.gpu.temporal?.frame.active ? rt.gpu.temporal.frame.phases : 1;

/** Reflections refine a quiet image under its average — the one source a quiet image lets change
 *  (`holdWebgpuFrame`): once they settle, the average restarts on the final scene, as on a landing,
 *  so no image drawn before stays in it at 1/N. `refining`: they still refine this image. */
export function restartTaaOnSettle(rt: WebgpuPagesRuntime, refining: boolean) {
  const frame = rt.gpu.temporal?.frame;
  if (!frame) return;
  restartTaaOnLanding(rt, frame.refining && !refining ? 1 : 0);
  frame.refining = refining;
}

/** Rank of this image among those whose lighting is SAMPLED (moving, on a history that averages
 *  its draws), or zero: a still image, or one nothing averages, shades every light. */
export function taaSampledRank(rt: WebgpuPagesRuntime) {
  const temporal = rt.gpu.temporal;
  return temporal?.frame.active ? temporal.frame.sampledRank : 0;
}

/**
 * True when a quiet image can be held without freezing an accumulation in progress: without
 * temporal antialiasing, switched off, or once the quiet images drawn close the still average's
 * whole cycles (`taaStillFrames`), every phase in it as often as every other. Read before the
 * image's entry, which a held image never makes: the image held is the last one drawn, and a
 * barrier's convergence image then replays it, to the bit (#26). A view that does not accumulate
 * keeps the count.
 */
export function taaSettled(rt: WebgpuPagesRuntime) {
  const temporal = rt.gpu.temporal;
  if (!temporal || !rt.gpu.temporalWanted) return true;
  return temporal.frame.stillFrames >= taaStillFrames(temporal.frame.phases);
}
