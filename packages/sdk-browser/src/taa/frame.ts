import { jitterViewProjection, taaJitter, upscalePhases } from './jitter.ts'
import { isOrthographic, taaExposure, writeTaaView } from './view.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { AccumulatedImage } from '../lighting/deferred/program.ts'
import { writtenFilter } from '../webgpu/blend/displayFilter.ts'
import { drawFrameAt, scalesTargets, taaRuns } from '../webgpu/pages/state/renderScale.ts'
import { dropTaaHistory } from './landing.ts'
import { encodeComposedMotion } from '../placement/composedMotionPass.ts'
import { taaViewCode } from '../visibility/shader/shadeMode.ts'
import { TAA_LEVEL_KNOBS } from './levels.ts'

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
  if (!temporal || !active) {
    // No temporal upscaler: the dynamic scale still steers a beauty image, which the composition
    // upscales spatially; a capture or a
    // diagnostic view at the bounds' maximum.
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
/**
 * Encodes this image's temporal pass and its display layers; returns the accumulated image
 * composition reads, `undefined` when none. Writes the uniform, updates motion, advances the
 * jitter, keeps the unjittered view-projection, the render grid and the exposure the
 * render-resolution histories are kept at; `asIs` false reads no as-is flags; the image is reconstructed to the display from whatever size it
 * was drawn at. `share`, seeded when blends or particles draw,
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
    { gpu, vis, run } = rt
  const pool = gpu.cache?.buffer
  if (!temporal?.frame.active || !gpu.depthView || !gpu.surfaces || !vis.visView || !vis.pageTable)
    return undefined
  if (!pool || !vis.concatPos || !vis.concatUv) return undefined
  const state = temporal.frame,
    scene = run.gate.revisions.scene
  const scan = state.sceneSeen !== scene
  if (!state.hasHistory) temporal.motion.reset()
  else temporal.motion.update(cam.eye, scan)
  // The linked placements' motion, which the GPU composes, follows the same decision.
  encodeComposedMotion(rt, device, encoder, cam.eye, state.hasHistory, scan)
  const { targetSize, displaySize } = gpu
  const { inputs, filterHistory } = temporal
  inputs.filter = writtenFilter(gpu.displayFilter) // `displayFilter.ts`
  const exposure = taaExposure(rt.lights.store?.environment)
  writeTaaView(
    device,
    temporal.uniform,
    state,
    cam,
    targetSize,
    displaySize,
    temporal.analysisSize,
    temporal.motion.moved || !!rt.compose?.moving,
    !!inputs.filter && filterHistory.written,
    !!vis.deformationCompute,
    exposure,
    // The display's interval, the world's controller's (`rt.views.main`), whichever view is drawn.
    rt.views.main.scale.frameIntervalMs,
    taaViewCode(run.diagnostic),
    TAA_LEVEL_KNOBS[gpu.temporalLevel],
  )
  inputs.current = current
  inputs.depth = gpu.depthView
  inputs.ids = vis.visView
  inputs.pages = vis.pageTable
  inputs.motion = temporal.motion.buffer
  inputs.pool = pool
  inputs.positions = vis.concatPos
  inputs.uvs = vis.concatUv
  inputs.flags = asIs ? gpu.surfaces.views()[3] : undefined
  inputs.share = asIs ? share : undefined
  inputs.reactive = share
  const output = temporal.encode(encoder, inputs, targetSize, isOrthographic(cam.projection))
  if (inputs.filter) gpu.targetBytes += filterHistory.uncounted()
  // Its two draws, the spatial anti-aliaser and the history update; the analysis' passes are
  // dispatches.
  run.gpuDrawCalls += 2
  state.sceneSeen = scene
  state.previousViewProjection.set(cam.viewProjection)
  state.previousEye.set(cam.eye)
  state.previousRender[0] = targetSize[0]
  state.previousRender[1] = targetSize[1]
  state.previousExposure = exposure
  state.hasHistory = true
  state.sample = (state.sample + 1) % state.phases
  state.stochasticSample++
  return output
}

/** Jitter phases of the view's cycle: one without temporal accumulation. */
export const taaPhaseCount = (rt: WebgpuPagesRuntime) =>
  rt.gpu.temporal?.frame.active ? rt.gpu.temporal.frame.phases : 1
