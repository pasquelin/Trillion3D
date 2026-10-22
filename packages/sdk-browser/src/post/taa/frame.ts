import { jitterViewProjection, taaJitter, upscalePhases } from './jitter.ts'
import { taaExposure, writeTaaView } from './view.ts'
import { preExposureOf } from '../exposure/pre.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { AccumulatedImage } from '../../lighting/deferred/program.ts'
import type { AsIsShare } from '../../lighting/deferred/asIsShare.ts'
import { writtenFilter } from '../../blend/display/displayFilter.ts'
import { drawFrameAt, scalesTargets, taaRuns } from '../../frame/backend/state/renderScale.ts'
import { dropTaaHistory } from './landing.ts'
import type { TaaFrameState } from './frameState.ts'
import type { TaaInputs } from './inputs.ts'
import { followVelocity, keepImage, readVelocityInputs } from './velocityFrame.ts'
import { taaViewCode } from '../../visibility/shader/shadeMode.ts'
import { FULL_ANALYSIS, taaKnobs } from './levels.ts'
import { contextReader } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { TEMPORAL_RULES } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { FIRST_ANALYSIS_VIEW } from './rejectionWgsl.ts'
import { writesGivenUp } from '../../frame/prepare/asIsShareTarget.ts'

/** The temporal pass's setting `field` the session holds (`temporalOptions.ts`), by its one
 *  resolver, read at each image. */
const temporalSetting = contextReader(TEMPORAL_RULES)

/** The analysis the level runs: the flicker measure where it rejects by it or a view shows it, the
 *  thin geometry detection where the setting asks for it or a view shows it. A history the measure
 *  left unwritten describes no image: it starts again, with the history it is told against. */
function analysisFor(
  rt: WebgpuPagesRuntime,
  state: TaaFrameState,
  knobs: ReturnType<typeof taaKnobs>,
  viewCode: number,
) {
  const thinOn = temporalSetting(rt, 'temporalThinGeometry')
  const work =
    viewCode >= FIRST_ANALYSIS_VIEW ? FULL_ANALYSIS : thinOn ? knobs.thinWork : knobs.work
  if (work.flicker && !state.flickerRan) dropTaaHistory(state)
  state.flickerRan = work.flicker
  if (work.thin && !state.thinRan) dropTaaHistory(state)
  state.thinRan = work.thin
  return work
}

/**
 * Image entry of the pass, called once per image drawn, where the image's motion is known. A
 * surface capture and a diagnostic view do not accumulate: they render at the centre of the
 * pixel, as their contract says; so does an image with the pass off, drawn at the controller's
 * scale, which the composition upscales. Otherwise the current
 * rank's jitter is set on the render view-projection, selection always reads the engine camera's
 * own planes. The pass runs on every image drawn, so a still view keeps converging; its history
 * is reset on a view cut alone (`dropTaaHistory`), the jitter back to phase zero with it;
 * each display pixel between render texels meets the phases that align with it (`sampleWeight`).
 */
export function beginTaaFrame(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const temporal = rt.gpu.temporal
  // Switched off, the pass is kept but nothing accumulates (`setWebgpuTemporalAntialiasing`).
  const active = taaRuns(rt)
  if (temporal) temporal.frame.active = active
  // The motion the passes read is measured once, by the velocity stage (`encodeVelocity`).
  followVelocity(rt, active)
  if (!temporal || !active) {
    // No temporal upscaler: the dynamic scale still steers a beauty image, which the composition
    // upscales spatially; a capture or a diagnostic view is drawn at the bounds' maximum.
    const { scale } = rt.views.active
    if (scalesTargets(rt)) return drawFrameAt(rt, scale.wanted(), !rt.run.textureConverging)
    return drawFrameAt(rt, scale.bounds.max, scale.bounds.max === scale.wanted())
  }
  const state = temporal.frame,
    { gate, textureConverging } = rt.run
  const revision = gate.temporalRevision
  if (revision !== undefined && revision !== state.viewSeen) {
    dropTaaHistory(state)
    state.viewSeen = revision
  }
  // Drawn at the controller's scale, which a texture convergence image does not steer.
  drawFrameAt(rt, rt.views.active.scale.wanted(), !textureConverging)
  // The jitter is in the pixels the frame is drawn in; its phases follow the ratio to the display.
  const { targetSize, displaySize } = rt.gpu
  state.phases = upscalePhases(targetSize[0], displaySize[0])
  taaJitter(state.sample, state.jitter, state.phases)
  // A view that has a plane draws unjittered: the cut would move with the jitter (a stand-in
  // camera no frame entry made carries no set).
  if (cam.viewSet?.jitters === false) state.jitter.fill(0)
  state.jitterGrid[0] = targetSize[0]
  state.jitterGrid[1] = targetSize[1]
  jitterViewProjection(
    state.viewProjection,
    cam.viewProjection,
    state.jitter[0],
    state.jitter[1],
    targetSize[0],
    targetSize[1],
  )
}
/** Render matrix of this image: the camera's when the image does not accumulate. */
export function taaRenderMatrix(rt: WebgpuPagesRuntime, cam: EngineCamera): ArrayLike<number> {
  const temporal = rt.gpu.temporal
  return temporal?.frame.active ? temporal.frame.viewProjection : cam.viewProjection
}
/** Render projection of this image into `out`: the camera's projection shifted by the jitter
 *  `beginTaaFrame` set — the same clip offset, from the same jitter and grid, as the render
 *  matrix's —, the camera's own when the image does not accumulate. */
export function taaRenderProjection(rt: WebgpuPagesRuntime, cam: EngineCamera, out: Float64Array) {
  const frame = rt.gpu.temporal?.frame
  if (!frame?.active) return copyMatrix4(out, cam.projection)
  const { jitter, jitterGrid } = frame
  return jitterViewProjection(
    out,
    cam.projection,
    jitter[0],
    jitter[1],
    jitterGrid[0],
    jitterGrid[1],
  )
}
/** Writes into `inputs` the lit image and what the blends wrote beside it: the as-is flags, or the
 *  share where the frame has one, the reactive value and what they give up of the history. */
function readSharedInputs(
  rt: WebgpuPagesRuntime,
  inputs: TaaInputs,
  current: GPUTextureView,
  asIs: boolean,
  share?: AsIsShare,
) {
  inputs.current = current
  inputs.flags = asIs ? rt.gpu.surfaces!.views()[3] : undefined
  inputs.share = asIs ? share?.view : undefined
  inputs.reactive = share?.view
  // Bound where the blends wrote it; else the 1×1 zero: nothing given up (`writesGivenUp`).
  inputs.givenUp = writesGivenUp(rt) ? share?.givenUpView : undefined
}

/**
 * Encodes this image's temporal pass and its display layers; returns the accumulated image
 * composition reads, `undefined` when none. Writes the uniform, advances the jitter, keeps the
 * unjittered view-projection, the render grid and the exposure the render-resolution histories are
 * kept at; its motion is the velocity stage's (`encodeVelocity`); `asIs` false reads no as-is flags;
 * the image is reconstructed to the display from whatever size it was drawn at. `share`, seeded when blends or particles draw,
 * holds the as-is share and the reactive value the blends, particles and water wrote
 * (`../../lighting/deferred/asIsShare.ts`), which shortens a moving pixel's history, and beside it
 * what the blends and transmissive layers give up of that history, which caps it.
 */
export function encodeTaaPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  current: GPUTextureView,
  asIs = true,
  share?: AsIsShare,
): AccumulatedImage | undefined {
  const temporal = rt.gpu.temporal,
    velocity = rt.gpu.velocity,
    { gpu, vis, run } = rt
  // The vectors and the placements' motion are the velocity stage's, drawn before the lighting
  // (`encodeVelocity`): the pass reads them, and its decisions about this image.
  if (!temporal?.frame.active || !gpu.surfaces || !velocity?.measured) return undefined
  const { inputs, filterHistory } = temporal
  if (!readVelocityInputs(rt, inputs, velocity)) return undefined
  inputs.vectors = velocity.vectors
  const state = temporal.frame,
    { moved, still } = velocity
  const { targetSize, displaySize } = gpu
  inputs.filter = writtenFilter(gpu.displayFilter) // `displayFilter.ts`
  const pre = preExposureOf(rt)
  const exposure = taaExposure(pre.shown)
  const knobs = taaKnobs(gpu.temporalLevel),
    viewCode = taaViewCode(run.diagnostic)
  const work = analysisFor(rt, state, knobs, viewCode)
  writeTaaView(
    device,
    temporal.uniform,
    state,
    cam,
    targetSize,
    displaySize,
    temporal.analysisSize,
    moved,
    !!inputs.filter && filterHistory.written,
    !!vis.deformationCompute,
    exposure,
    // The display's interval, the world's controller's (`rt.views.main`), whichever view is drawn.
    rt.views.main.scale.frameIntervalMs,
    viewCode,
    knobs,
    work,
    pre.now / state.previousPreExposure,
  )
  readSharedInputs(rt, inputs, current, asIs, share)
  const output = temporal.encode(encoder, inputs, targetSize, cam.perspective === 0, work)
  if (inputs.filter) gpu.targetBytes += filterHistory.uncounted()
  // Its draws, the spatial anti-aliaser where the level runs one and the history update; the
  // analysis' passes are dispatches.
  run.gpuDrawCalls += work.antiAlias ? 2 : 1
  keepImage(rt, state, cam, targetSize)
  state.previousExposure = exposure
  state.previousPreExposure = pre.now
  state.accumulated = still ? state.accumulated + 1 : 1
  state.sample = (state.sample + 1) % state.phases
  state.stochasticSample++
  return output
}

/** Jitter phases of the view's cycle: one without temporal accumulation. */
export const taaPhaseCount = (rt: WebgpuPagesRuntime) =>
  rt.gpu.temporal?.frame.active ? rt.gpu.temporal.frame.phases : 1
