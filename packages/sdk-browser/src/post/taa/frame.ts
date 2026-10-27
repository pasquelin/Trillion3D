import { jitterViewProjection, taaJitter, upscalePhases } from './jitter.ts'
import { writeTaaView, type TaaHistoryTerms } from './view.ts'
import { preExposureOf } from '../exposure/pre.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { AccumulatedImage } from '../../lighting/deferred/program.ts'
import type { Responsive } from '../../blend/responsive.ts'
import { writtenFilter } from '../../blend/display/displayFilter.ts'
import { shownTranslucency } from '../../blend/translucency.ts'
import { drawFrameAt, scalesTargets, taaRuns } from '../../frame/backend/state/renderScale.ts'
import { dropTaaHistory } from './landing.ts'
import type { MeasuredScene } from './analysis.ts'
import type { TaaFrameState } from './frameState.ts'
import type { TaaInputs } from './inputs.ts'
import { followVelocity, keepImage, readVelocityInputs } from './velocityFrame.ts'
import { taaViewCode } from '../../visibility/shader/shadeMode.ts'
import { FULL_ANALYSIS, taaKnobs, type AnalysisWork } from './levels.ts'
import {
  TEMPORAL_RULES,
  THIN_GEOMETRY_SHADING_RANGES,
  type TemporalValues,
} from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { resolveSettingsStamped } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { FLAGS_VIEW } from '../../materials/surface/surfaceOutputs.ts'
import { FIRST_ANALYSIS_VIEW } from './rejectionShared.ts'
import { writesResponsive } from '../../frame/prepare/responsiveTarget.ts'
import { keepFrame, planFrame, type FrameSlices } from './historyFrames.ts'
import { sameShape, wantedShapeOf, type HistoryShape } from './historyShape.ts'
import { executionOf } from './waveOps.ts'
import { remakeTemporalFormats } from './prepare.ts'
import { fuseMotionBlur, motionBlurPlanned } from '../../frame/render/effectsFrame.ts'

/** What the pass's uniform says of its history this image (`writeTaaView`), rewritten by each. */
const historyTerms = {} as { -readonly [K in keyof TaaHistoryTerms]: TaaHistoryTerms[K] }
/** The pass's settings this image, resolved in place: the one reading of them every image makes. */
const settings = {} as TemporalValues

/** The analyses of a level without the flicker measure, made once for each: a flicker period of 0
 *  runs none. */
const withoutFlicker = new WeakMap<AnalysisWork, AnalysisWork>()
const flickerlessOf = (work: AnalysisWork) => {
  let made = withoutFlicker.get(work)
  if (!made) withoutFlicker.set(work, (made = { ...work, flicker: false }))
  return made
}

/** The analysis the level and the settings ask of an image of view `viewCode`. */
function workOf(knobs: ReturnType<typeof taaKnobs>, viewCode: number) {
  const shown = viewCode >= FIRST_ANALYSIS_VIEW
  const work = shown ? FULL_ANALYSIS : settings.temporalThinGeometry ? knobs.thinWork : knobs.work
  return !shown && settings.temporalFlickeringPeriod === 0 ? flickerlessOf(work) : work
}

/** What the thin coverage measure reads of this image, rewritten by each. */
const measured = {} as MeasuredScene

/** The image each view's measures were last taken for. */
const measuredAt = new WeakMap<object, number>()

/**
 * The measures the analysis takes on the scene before any translucency is composed onto `image` —
 * the lit image, or the one its depth of field blurred where no near layer came before —, once an image, where the flicker measure or the thin geometry
 * detection runs (`TemporalAntialiasing.measure`): the flicker luma exposed as the shading rejection
 * measures it (the shading's exposure offset, `view.preExposure.y`), the material's coverage where the detection runs. Called before each
 * composition of the translucency (`../../frame/render/encodeBlend.ts`, `surfaceLighting.ts`), the
 * first one measuring.
 */
export function measureBeforeTranslucency(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  image: GPUTextureView,
) {
  const temporal = rt.gpu.temporal,
    { gpu, vis, run } = rt
  if (!temporal?.frame.active || !vis.visView || !vis.pageTable || !gpu.surfaces) return
  if (measuredAt.get(temporal) === run.frame) return
  resolveSettingsStamped(TEMPORAL_RULES, rt.context, settings)
  const work = workOf(taaKnobs(gpu.temporalLevel, settings), taaViewCode(run.diagnostic))
  if (!work.flicker && !work.thin) return
  const scale = 2 ** settings.temporalShadingExposureOffset
  measured.ids = vis.visView
  measured.pages = vis.pageTable
  measured.flags = gpu.surfaces.views()[FLAGS_VIEW]
  measured.range = THIN_GEOMETRY_SHADING_RANGES.indexOf(settings.temporalThinGeometryShadingRange)
  if (temporal.measure(encoder, image, measured, gpu.targetSize, scale, work.thin))
    measuredAt.set(temporal, run.frame)
}

/** Whether the analysis `work` makes a history it left unwritten describe no image: a flicker or
 *  thin geometry measure running again after images without it. Such a history starts again, with
 *  the history it is told against (`keepAnalysis`). */
const analysisRestarts = (state: TaaFrameState, work: AnalysisWork) =>
  (work.flicker && !state.flickerRan) || (work.thin && !state.thinRan)

/** Keeps the analysis `work` this image runs, the history started again where `restart`
 *  (`analysisRestarts`). */
function keepAnalysis(state: TaaFrameState, work: AnalysisWork, restart: boolean) {
  if (restart) dropTaaHistory(state)
  state.flickerRan = work.flicker
  state.thinRan = work.thin
}

/**
 * Image entry of the pass, called once per image drawn, where the image's motion is known. A view
 * with no pass — a surface capture, a capture image drawn with it off — and a diagnostic view do
 * not accumulate: they render at the centre of the pixel, as their contract says; so does an image
 * with the pass off, drawn at the controller's scale, which the composition upscales. A colour
 * capture holds a pass of its own and accumulates its images (`startCaptureAccumulation`). Otherwise the current
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
  // The lighting's noise turns on every image drawn, with the pass or without it; a capture drawn aside, with no pass of its
  // own, is not the view's, and leaves its sequence as it was.
  if (temporal && (active || !rt.capture.capturing)) temporal.frame.stochasticSample++
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
/** Writes into `inputs` the lit image and what the blends wrote beside it: the responsiveness they
 *  carry. */
function readSharedInputs(
  rt: WebgpuPagesRuntime,
  inputs: TaaInputs,
  current: GPUTextureView,
  responsive?: Responsive,
) {
  inputs.current = current
  inputs.translucency = shownTranslucency(rt.gpu)
  // Bound where the blends wrote it; else the 1×1 zero: none (`writesResponsive`).
  inputs.responsive = writesResponsive(rt) ? responsive?.view : undefined
}

/** The pass of the view this image is encoded for. */
type Temporal = NonNullable<WebgpuPagesRuntime['gpu']['temporal']>

/** Remakes the history where the level and these settings ask another shape — a level of another
 *  size, a setting of the resurrection —, which starts again; the pass itself, where the history
 *  formats the setting asks are not the ones it was made with. Returns the shape asked. */
function fitHistory(rt: WebgpuPagesRuntime, temporal: Temporal) {
  const { gpu } = rt
  if (temporal.packed !== settings.temporalHistoryPacked) remakeTemporalFormats(rt, temporal)
  const shape = wantedShapeOf(
    rt,
    temporal,
    gpu.temporalLevel,
    gpu.displaySize[0],
    gpu.displaySize[1],
  )
  if (!temporal.shape || !sameShape(temporal.shape, shape)) {
    const before = temporal.historyBytes
    if (temporal.resize(shape, ...gpu.allocatedSize)) dropTaaHistory(temporal.frame)
    gpu.targetBytes += temporal.historyBytes - before
  }
  return shape
}

/** What the uniform of an image says besides the camera and the settings: the history's shape and
 *  frames, the level's knobs and analysis, the view, the pre-exposures, and whether a placement moved. */
interface ImageTerms {
  readonly shape: HistoryShape
  readonly slices: FrameSlices
  readonly knobs: ReturnType<typeof taaKnobs>
  readonly work: AnalysisWork
  readonly viewCode: number
  readonly pre: ReturnType<typeof preExposureOf>
  readonly moved: boolean
}

/** Writes the pass's uniform for this image. */
function writeImageUniform(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  temporal: Temporal,
  cam: EngineCamera,
  { shape, slices, knobs, work, viewCode, pre, moved }: ImageTerms,
) {
  const { gpu, vis, views } = rt
  const { inputs, frame, filterHistory } = temporal
  historyTerms.width = shape.width
  historyTerms.height = shape.height
  historyTerms.scale = frame.historyScale
  historyTerms.field = knobs.reprojectionField
  historyTerms.fieldSpeed = settings.temporalReprojectionFieldSpeed
  historyTerms.resurrects = slices.resurrects
  historyTerms.settings = settings
  writeTaaView(
    device,
    temporal.uniform,
    frame,
    cam,
    gpu.targetSize,
    gpu.displaySize,
    temporal.analysisSize,
    moved,
    !!inputs.filter && filterHistory.written,
    !!vis.deformationCompute || vis.rasters.offsets.length > 0,
    // The interval between the two last images drawn, the world's controller's (`rt.views.main`), whichever view is drawn.
    views.main.scale.frameIntervalMs,
    viewCode,
    knobs,
    work,
    // The colour history holds light multiplied by the pre-exposure of the image before, brought to this image's by the ratio.
    pre.now / pre.previous,
    historyTerms,
    pre.now,
  )
}

/** Keeps what the next image reads of this one: its camera and frame, the number of
 *  still images, and the ranks of the jitter and of the lighting samples. */
function keepTaaImage(
  rt: WebgpuPagesRuntime,
  state: TaaFrameState,
  cam: EngineCamera,
  { slices, pre }: ImageTerms,
  holds: boolean,
  still: boolean,
) {
  const { targetSize } = rt.gpu
  keepImage(rt, state, cam, targetSize)
  keepFrame(state.ring, slices, holds, cam.viewProjection, cam.eye, pre.now, targetSize)
  state.accumulated = still ? state.accumulated + 1 : 1
  state.sample = (state.sample + 1) % state.phases
}

/**
 * Encodes this image's temporal pass and its display layers; returns the accumulated image
 * composition reads, `undefined` when none. Writes the uniform, advances the jitter, keeps the
 * unjittered view-projection, the render grid the render-resolution histories are
 * kept at; its motion is the velocity stage's (`encodeVelocity`); the image is reconstructed to the
 * display from whatever size it was drawn at. `responsive`, cleared when blends draw, holds the
 * responsiveness the blends and transmissive layers carry (`../../blend/responsive.ts`), which the
 * analysis reads as the flags of the pixel. The as-is pixels of a debug view are none of its: the
 * composition draws them over its output (`../../lighting/deferred/shaders.ts`).
 */
export function encodeTaaPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  current: GPUTextureView,
  responsive?: Responsive,
): AccumulatedImage | undefined {
  const temporal = rt.gpu.temporal,
    velocity = rt.gpu.velocity,
    { gpu, run } = rt
  // Nothing is flattened for the motion blur until this image asks it (below).
  if (temporal) temporal.inputs.flatten = undefined
  // The vectors and the placements' motion are the velocity stage's, drawn before the lighting
  // (`encodeVelocity`): the pass reads them, and its decisions about this image.
  if (!temporal?.frame.active || !gpu.surfaces || !velocity?.measured) return undefined
  const { inputs } = temporal
  if (!readVelocityInputs(rt, inputs)) return undefined
  inputs.vectors = velocity.vectors
  const state = temporal.frame,
    { moved, still } = velocity
  inputs.filter = writtenFilter(gpu.displayFilter) // `displayFilter.ts`
  resolveSettingsStamped(TEMPORAL_RULES, rt.context, settings)
  const pre = preExposureOf(rt)
  const knobs = taaKnobs(gpu.temporalLevel, settings),
    viewCode = taaViewCode(run.diagnostic)
  const work = workOf(knobs, viewCode),
    restart = analysisRestarts(state, work)
  const shape = fitHistory(rt, temporal)
  // The frames this image reads and writes in the history, which starts again with the analysis.
  const holds = state.hasHistory && !restart
  const slices = planFrame(state.ring, holds)
  // The half-size image the scene's chain reads, written beside the resolved colour: nothing
  // then draws it — unless the quality asks the chain's own pass for it, or the motion blur,
  // which draws after and writes its own, does (`temporalDownsampleQuality`).
  const half = settings.temporalDownsampleQuality === 'low' && !motionBlurPlanned(rt)
  const execution = executionOf(rt, device)
  // The analysis, the update and the resolve run whole or not at all: a pass missing a program
  // leaves the histories, the flags and the counts as the last image left them (`chainReady`).
  if (!temporal.ready(inputs, slices, work, half, execution)) return undefined
  keepAnalysis(state, work, restart)
  state.slices = slices
  // The pass weighs the pre-exposed colour as the image holds it: the tone weights `1 / (luma + 4)` and the measures do not
  // follow the exposure the composition applies later.
  const terms = { shape, slices, knobs, work, viewCode, pre, moved }
  writeImageUniform(rt, device, temporal, cam, terms)
  readSharedInputs(rt, inputs, current, responsive)
  // The motion blur flattens its motion in the nearest velocity, which dilates it: the blur's
  // targets and uniform are set up here, ahead of the dispatch.
  inputs.flatten = fuseMotionBlur(rt, cam, velocity)
  const output = temporal.encode(
    encoder,
    inputs,
    gpu.targetSize,
    slices,
    cam.perspective === 0,
    work,
    half,
    execution,
  )
  if (inputs.filter) gpu.targetBytes += temporal.layers.uncounted()
  keepTaaImage(rt, state, cam, terms, holds, still)
  return output
}

/** Jitter phases of the view's cycle: one without temporal accumulation. */
export const taaPhaseCount = (rt: WebgpuPagesRuntime) =>
  rt.gpu.temporal?.frame.active ? rt.gpu.temporal.frame.phases : 1
