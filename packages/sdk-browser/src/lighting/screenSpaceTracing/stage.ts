import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { multiplyMatrix4, negateRowMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import {
  SCREEN_SPACE_TRACING_RULES,
  resolveScreenSpaceMethod,
  screenIndirectOn,
  screenReflectionsOn,
} from '../../../../sdk-core/src/contracts/screenSpaceTracingOptions.ts'
import {
  resolveSettings,
  resolveSettingsStamped,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { skyLightReadOf } from '../../frame/render/skyLightState.ts'
import { noiseFrame } from '../../frame/render/noiseFrame.ts'
import { wantsContractLighting } from '../../frame/prepare/lit.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import { screenProbeVectors } from '../bounce/screen/vectorSource.ts'
import {
  createScreenSpaceTargets,
  createScreenSpaceViewBuffer,
  encodeHalfResColor,
  encodeReducedColor,
  encodeScreenDiffuse,
  encodeScreenReflectionCompose,
  encodeScreenReflectionTemporal,
  encodeScreenReflections,
  type ScreenSpaceInputs,
  type ScreenSpaceTargets,
} from './frame.ts'
import {
  SCREEN_REFLECTION_LEVEL_CODE,
  pixelRadiusScale,
  reducedColorScaleBias,
  reducedColorSize,
  previousScreenScaleBias,
  screenReflectionParams,
} from './screenSpaceQuality.ts'
import {
  createDenoiseMeta,
  createDenoiseSignal,
  encodeDenoise,
  encodeDenoiseKeep,
  type DenoiseMeta,
  type DenoiseRun,
  type DenoiseSignalState,
  type DenoiseSource,
} from './denoise/frame.ts'
import type { DenoiseSignal } from './denoise/signalWgsl.ts'
import {
  SCREEN_SPACE_VIEW_WORDS,
  writeScreenSpaceView,
  type ScreenSpaceViewFields,
} from './screenSpaceView.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import type { HeldImage } from '../reflections/litImage.ts'
import {
  screenReflectionPlan,
  screenReflectionTemporalRequired,
  screenReflectionTurn,
  screenReflectionTileMaxRoughness,
} from './settings.ts'

/** What a runtime keeps of the screen-space traces: the targets of its size, the view uniform and the sampler of the image held. */
interface Held {
  /** The device the resources are made on: the release retires them there. */
  device: GPUDevice
  targets: ScreenSpaceTargets
  key: string
  view: GPUBuffer
  sampler: GPUSampler
  /** The bilinear sampler the half-resolution image is read with. */
  bilinear: GPUSampler
  turn: number
  /** The inputs written for the image `inputsFrame`: the passes beside the traces read them as they are. */
  inputs?: ScreenSpaceInputs
  inputsFrame?: number
  /** The denoiser's state: a signal's textures, the surface kept for the accumulation, the occlusion of a denoiser that is off (all ones). */
  denoise: {
    signals: Partial<Record<DenoiseSignal, DenoiseSignalState>>
    meta?: DenoiseMeta
    white?: { texture: GPUTexture; view: GPUTextureView }
  }
}
const held = new WeakMap<object, Held>()

/** Frees what a runtime's screen-space state holds. */
function releaseHeld(state: Held) {
  state.targets.destroy()
  state.view.destroy()
  for (const signal of Object.values(state.denoise.signals)) signal?.destroy()
  state.denoise.meta?.destroy()
  state.denoise.white?.texture.destroy()
}

/** The view's settings, read by the stamped reader into this one object (an image where none was written costs a compare). */
const values = resolveSettings(SCREEN_SPACE_TRACING_RULES, {})

const words = new Float32Array(SCREEN_SPACE_VIEW_WORDS)
const unsigned = new Uint32Array(words.buffer)
const inverseProjection = new Float64Array(16)
const view = new Float64Array(16)
const flipped = new Float64Array(16)
const viewToWorld = new Float64Array(16)
const clipToWorld = new Float64Array(16)
const prevClipToWorld = new Float64Array(16)
const clipToPrevClip = new Float64Array(16)
const viewProjectionNow = new Float64Array(16)

/** Whether the view's reflections are the screen-space trace this image: the method says so and the view holds the last lit image to read. */
export function screenReflectionsAsked(
  rt: WebgpuPagesRuntime,
  reflecting: boolean,
  sceneTraces: boolean,
) {
  resolveSettingsStamped(SCREEN_SPACE_TRACING_RULES, rt.context, values)
  const reflection = rt.gpu.reflection
  const ready =
    reflecting &&
    !!reflection &&
    !!rt.gpu.surfaces &&
    !!rt.vis.gpuHiz?.depth() &&
    wantsContractLighting(rt) &&
    drawsLit(rt.run.diagnostic)
  // The scene's trace answers where the method names it and it runs; else the screen, from any method but off.
  return (
    ready &&
    resolveScreenSpaceMethod(
      values.reflectionMethod,
      sceneTraces,
      screenReflectionsOn(values, reflection.lit.held.valid),
      true,
    ) === 'screen'
  )
}

/** What a runtime keeps for this image's size and plan: made where there is none or the size, the indirect light's ratio or the stencil changed. */
function heldFor(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
  plan: ReturnType<typeof screenReflectionPlan>,
) {
  const key = `${width}x${height}:${values.diffuseIndirectHalfRes}:${plan.stencil}`
  let state = held.get(viewKey(rt.gpu))
  if (!state || state.key !== key || state.device !== device) {
    // Retired, not destroyed: earlier commands of this image may name what it held (a replaced device runs nothing more: it goes at once).
    if (state) {
      const old = state
      retire(old.device, { destroy: () => releaseHeld(old) }, old.device !== device)
    }
    state = {
      device,
      targets: createScreenSpaceTargets(
        device,
        width,
        height,
        values.diffuseIndirectHalfRes ? 2 : 1,
        plan.stencil,
      ),
      key,
      view: createScreenSpaceViewBuffer(device),
      sampler: device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' }),
      bilinear: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
      turn: 0,
      denoise: { signals: {} },
    }
    held.set(viewKey(rt.gpu), state)
  }
  return state
}

/** The view's matrices, into the scratch ones: the projection the depth was drawn with, the view space it implies (z forward), and the last image's. */
function writeViewMatrices(
  projection: ArrayLike<number>,
  vp: ArrayLike<number>,
  lastViewProjection: Float64Array,
) {
  invertMatrix4(inverseProjection, projection)
  multiplyMatrix4(view, inverseProjection, vp as Float64Array)
  negateRowMatrix4(flipped, view, 2)
  invertMatrix4(viewToWorld, flipped)
  viewProjectionNow.set(vp)
  invertMatrix4(clipToWorld, viewProjectionNow)
  invertMatrix4(prevClipToWorld, lastViewProjection)
  multiplyMatrix4(clipToPrevClip, lastViewProjection, clipToWorld)
}

/** The reflections' four numbers of the view: the parameters' first three, then the held image's pre-exposure undone (the held image is lit multiplied by it; the reflection target is read before it). */
const reflectionFields = (
  code: number,
  turn: number,
  preExposure: number,
): [number, number, number, number] => [
  ...(screenReflectionParams(
    values.screenReflectionIntensity,
    values.screenReflectionMaxRoughness,
    code,
    false,
    turn,
  ).slice(0, 3) as [number, number, number]),
  1 / preExposure,
]

/** The fields of the view uniform of this image: the matrices, the sizes of the chain, the frame, the reflections' parameters and the temporal filter's jitter. */
function viewFields(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  targets: Pick<ScreenSpaceTargets, 'ratio' | 'tilesAcross' | 'tilesDown'>,
  plan: ReturnType<typeof screenReflectionPlan>,
  reflection: NonNullable<WebgpuPagesRuntime['gpu']['reflection']>,
  lastHeld: PreviousImage,
): ScreenSpaceViewFields {
  const [width, height] = rt.gpu.targetSize
  const { frame } = reflection
  const projection = cam.projection
  const vp = frame.viewProjection
  writeViewMatrices(projection, vp, lastHeld.viewProjection)
  const perspective = cam.perspective !== 0
  const tan = perspective ? 1 / projection[0] : 1
  const code = SCREEN_REFLECTION_LEVEL_CODE[plan.quality]
  const taa = rt.gpu.temporal?.frame
  const frameIndex = noiseFrame(rt) % 8
  const turn = screenReflectionTurn(!!taa?.active, taa?.sample ?? 0, noiseFrame(rt))
  const jitter = frame.jitter ?? [0, 0]
  const chain = reducedColorScaleBias(
    [width, height],
    [width, height],
    [0, 0],
    reducedColorSize(width, height),
  )
  return {
    worldToClip: vp,
    clipToWorld,
    worldToView: flipped,
    viewToWorld,
    clipToPrevClip,
    prevClipToWorld,
    depth: [-projection[10], projection[14], -projection[11], projection[15]],
    size: [width, height],
    perspective,
    origin: [frame.eye[0], frame.eye[1], frame.eye[2]],
    forward: [flipped[2], flipped[6], flipped[10]],
    pixelRadius: pixelRadiusScale(perspective, tan, width),
    projectionScale: [projection[0], projection[5]],
    previous: previousScreenScaleBias(lastHeld.size, [0, 0], lastHeld.size),
    reduced: [...chain.scaleBias],
    reducedLimit: [chain.uvMax[0], chain.uvMax[1], targets.ratio, 0.5],
    frame: [frameIndex, turn, rt.run.frame, code],
    reflection: reflectionFields(code, turn, lastHeld.preExposure),
    tiles: [targets.tilesAcross, targets.tilesDown, 0, screenReflectionTileMaxRoughness(values)],
    minSpecular: values.screenReflectionTilesMinSpecular,
    preExposure: frame.preExposure ?? 1,
    sky: [values.screenGiSkyDistance, 1 / lastHeld.preExposure],
    temporal: [(jitter[0] * width) / 2, (jitter[1] * height) / 2, 1, frame.historyCut ? 1 : 0],
    blur: [values.screenReflectionFilterSize, values.screenReflectionCatmullRom ? 1 : 0, 1],
  }
}

/** The targets, the view uniform and the inputs of this image, written and ready: what both traces share. */
function prepare(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const reflection = rt.gpu.reflection!
  const [width, height] = rt.gpu.targetSize
  const plan = screenReflectionPlan(values)
  const state = heldFor(rt, device, width, height, plan)
  const inputs = writeInputs(rt, device, cam, state.targets, plan, state.view, state.sampler)
  state.inputs = inputs
  state.inputsFrame = rt.run.frame
  return { state, inputs, plan, reflection }
}

/** The view uniform `view` written for this image and the inputs of the passes that read the frame as the traces do. */
function writeInputs(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  targets: Pick<ScreenSpaceTargets, 'ratio' | 'tilesAcross' | 'tilesDown'>,
  plan: ReturnType<typeof screenReflectionPlan>,
  view: GPUBuffer,
  sampler: GPUSampler,
  previous: PreviousImage = rt.gpu.reflection!.lit.held,
): ScreenSpaceInputs {
  const reflection = rt.gpu.reflection!
  const surfaces = rt.gpu.surfaces!
  writeScreenSpaceView(words, unsigned, viewFields(rt, cam, targets, plan, reflection, previous))
  device.queue.writeBuffer(view, 0, words)
  const views = surfaces.views()
  return {
    view,
    depth: rt.vis.gpuHiz!.depth()!,
    normals: views[1],
    flags: views[3],
    lobes: surfaces.lobesView,
    vectors: screenProbeVectors(rt) ?? reflection.noVectors,
    sampler,
  }
}

/** The view uniform of the passes beside the traces that read the frame as they do (the shadow denoiser, the planar reflections) where the traces made none this image,
 *  once a view, and the inputs written for the image `frame` (one image writes them once, whoever asks first). */
type Beside = { device: GPUDevice; view: GPUBuffer; frame?: number; inputs?: ScreenSpaceInputs }
/** A view's, in two: `traces` for the passes that read the lit image's last view-projection, `kept` for a pass that keeps the last image's itself (`PreviousImage`): the shadow denoiser, which runs in views that reflect nothing. */
const beside = new WeakMap<object, { traces?: Beside; kept?: Beside }>()
/** What the last image left of its view, where a pass reprojects from it: the view-projection it was drawn with, its size and its pre-exposure (a lit image held, `HeldImage`, is one). */
export type PreviousImage = Pick<HeldImage, 'viewProjection' | 'size' | 'preExposure'>
const NO_TARGETS = { ratio: 1, tilesAcross: 0, tilesDown: 0 } as const

/** Whether the view holds what `screenSpaceFrameInputs` needs: the reflection state staged for this image (its view-projection and the held image's), the surfaces and the depth pyramid. */
export const screenSpaceFrameReady = (rt: WebgpuPagesRuntime) =>
  rt.gpu.reflection?.stagedFrame === rt.run.frame && !!(rt.gpu.surfaces && rt.vis.gpuHiz?.depth())

/**
 * The inputs of this image for a pass beside the screen-space traces that reads the frame as they do (the view's matrices, the depth pyramid, the surface's targets, the vectors): written
 * once called. None while the view holds no reflection state, surfaces or depth pyramid.
 */
export function screenSpaceFrameInputs(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  previous?: PreviousImage,
): ScreenSpaceInputs | undefined {
  if (!screenSpaceFrameReady(rt)) return undefined
  const key = viewKey(rt.gpu)
  const depth = rt.vis.gpuHiz!.depth()
  // Written this image from this view's depth pyramid: the traces' inputs are the ones to read (their view holds the lit image's last view-projection, so not for a `previous` of the pass's own), else the ones a pass beside them wrote.
  const traced = previous ? undefined : held.get(key)
  if (traced?.inputsFrame === rt.run.frame && traced.inputs?.depth === depth) return traced.inputs
  const sides = beside.get(key) ?? {}
  beside.set(key, sides)
  const side = previous ? 'kept' : 'traces'
  let mine = sides[side]
  if (mine?.device === device && mine.frame === rt.run.frame && mine.inputs?.depth === depth)
    return mine.inputs
  // Made on another device (the view moved): its uniform goes with it, the inputs are written again on this one.
  if (mine && mine.device !== device) {
    const old = mine
    retire(old.device, { destroy: () => old.view.destroy() }, true)
    mine = undefined
  }
  if (!mine) mine = sides[side] = { device, view: createScreenSpaceViewBuffer(device) }
  resolveSettingsStamped(SCREEN_SPACE_TRACING_RULES, rt.context, values)
  const plan = screenReflectionPlan(values)
  mine.frame = rt.run.frame
  return (mine.inputs = writeInputs(
    rt,
    device,
    cam,
    NO_TARGETS,
    plan,
    mine.view,
    postSamplers(device).point,
    previous,
  ))
}

/** The denoiser run of this image: its samples, its pre-convolutions and whether it accumulates over the images. */
function denoiseRun(
  rt: WebgpuPagesRuntime,
  samples: number,
  preConvolution: number,
  temporal: boolean,
): DenoiseRun {
  const frame = rt.gpu.reflection!.frame
  return {
    samples,
    preConvolution,
    temporal,
    frame: rt.run.frame,
    cut: !!frame.historyCut,
    noiseFrame: noiseFrame(rt) % 8,
    exposure: frame.preExposure ?? 1,
  }
}

/** Denoises `source` (the trace's output) as `signal`, at `ratio` pixels a texel, and keeps the surface for the next image when it accumulates. */
function runDenoise(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: Held,
  inputs: ScreenSpaceInputs,
  signal: DenoiseSignal,
  ratio: 1 | 2,
  source: DenoiseSource,
  run: DenoiseRun,
) {
  const { width, height } = state.targets
  const signals = state.denoise.signals
  const mine = (signals[signal] ??= createDenoiseSignal(device, signal, width, height, ratio))
  const meta = (state.denoise.meta ??= createDenoiseMeta(device, width, height))
  const result = encodeDenoise(device, encoder, mine, meta, inputs, source.a, source, run)
  if (run.temporal)
    encodeDenoiseKeep(device, encoder, meta, inputs, source.a, run.frame, width, height)
  return result
}

/**
 * The image's reflections traced from the screen, in the place of the scene's trace: the rays march the depth pyramid and read the last lit image,
 * the temporal filter blends them with the image before when it is asked, and the result is composed with the sky light into the reflection target
 * the opaque resolve reads (`ScreenReflection.target`, layer 0). Call it where `screenReflectionsAsked` says so; the trace of the scene is not run then.
 */
export function encodeScreenSpaceReflections(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { state, inputs, plan, reflection } = prepare(rt, device, cam)
  // The rays read the last lit image, or its half-resolution mean through a bilinear sampler.
  let colour = reflection.lit.image.view
  if (values.screenReflectionHalfResColor) {
    encodeHalfResColor(device, encoder, state.targets, colour)
    colour = state.targets.halfResView
  }
  const reads = values.screenReflectionHalfResColor
    ? { ...inputs, sampler: state.bilinear }
    : inputs
  encodeScreenReflections(device, encoder, state.targets, reads, colour, plan)
  const taaActive = !!rt.gpu.temporal?.frame?.active
  let traced = state.targets.reflectionView
  if (plan.denoise) {
    // The denoiser replaces the temporal filter: reconstruction along the lobe, pre-convolutions, accumulation.
    traced = runDenoise(
      device,
      encoder,
      state,
      inputs,
      'reflections',
      1,
      { a: state.targets.reflectionView, b: state.targets.confusionTarget().view },
      denoiseRun(
        rt,
        values.screenReflectionDenoiserSamples,
        values.screenReflectionDenoiserPreConvolution,
        values.screenReflectionDenoiserTemporal,
      ),
    ).a
  } else if (screenReflectionTemporalRequired(values, taaActive)) {
    encodeScreenReflectionTemporal(device, encoder, state.targets, inputs, state.turn)
    traced = state.targets.historyViews[state.turn % 2]
    state.turn++
  }
  encodeScreenReflectionCompose(
    device,
    encoder,
    state.targets,
    inputs,
    traced,
    reflection.targetView,
    skyLightReadOf(rt),
  )
}

/**
 * THE SCREEN INDIRECT LIGHT'S OUTPUT, for the pass that composes it with the indirect light (the screen probes' integration):
 * - `diffuse`: a view of an `rgba16float` texture of `size` texels, one per `ratio` (1 or 2) pixels of the image on each axis (texel `t` stands for the
 *   pixel centre `t * ratio + 0.5`; a pixel reads the texel `floor(pixel / ratio)`). `rgb` is the MEAN RADIANCE the
 *   cosine-weighted rays brought back, in the units of the reflection target (the last lit image divided by the pre-exposure it was lit with; not
 *   pre-exposed): the irradiance is pi times it, the diffuse light albedo times it. A ray that hit nothing brought none. `a` is 1.
 * - `occlusion`: a view of a texture of the same texels (`r32float`, or, from the denoiser, `rg32float`: the first channel is the one): ONE MINUS the share of the rays that hit (0 where all hit, 1 where none): the
 *   openness the rays found, the ambient occlusion factor to multiply the sky light by; 1 at a pixel nothing was traced for.
 * A pixel nothing was traced for (no surface, the far plane, an unlit surface) holds zero radiance and an occlusion of 1. With `screenGiDenoiser` the two are
 * the denoiser's result (the light's `a` stays 1); without it, the light is the rays' mean and the occlusion is 1 everywhere.
 */
export interface ScreenIndirectOutput {
  readonly diffuse: GPUTextureView
  readonly occlusion: GPUTextureView
  readonly ratio: 1 | 2
  readonly size: readonly [number, number]
}

/** Whether the view's indirect diffuse light is the screen's this image: the method names it and the last lit image and the depth it kept are held. */
export function screenIndirectAsked(rt: WebgpuPagesRuntime, sceneOn: boolean) {
  resolveSettingsStamped(SCREEN_SPACE_TRACING_RULES, rt.context, values)
  const reflection = rt.gpu.reflection
  return (
    !!reflection &&
    !!rt.gpu.surfaces &&
    !!rt.vis.gpuHiz?.depth() &&
    wantsContractLighting(rt) &&
    drawsLit(rt.run.diagnostic) &&
    resolveScreenSpaceMethod(
      values.globalIlluminationMethod,
      sceneOn,
      screenIndirectOn(values, reflection.lit.held.valid),
      false,
    ) === 'screen'
  )
}

/** Traces the screen indirect light of this image (the last lit image reduced, then the rays) and returns its output (`ScreenIndirectOutput`). The depth the
 *  last image kept (`ScreenReflection.depthView`) is written by the scene's reflection trace, so it is the last image's only where that trace ran. */
export function encodeScreenSpaceIndirect(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
): ScreenIndirectOutput {
  const { state, inputs, reflection } = prepare(rt, device, cam)
  const { targets } = state
  encodeReducedColor(
    device,
    encoder,
    targets,
    inputs,
    reflection.lit.image.view,
    reflection.depthView,
  )
  encodeScreenDiffuse(device, encoder, targets, inputs, values.screenGiLevel)
  const { diffuseView, occlusionView } = targets.indirectTargets()
  const size = [
    ceilDiv(targets.width, targets.ratio),
    ceilDiv(targets.height, targets.ratio),
  ] as const
  if (!values.screenGiDenoiser) {
    // No denoiser: the rays' mean is the light, and nothing is occluded.
    const white = (state.denoise.white ??= whiteOcclusion(device, size))
    return { diffuse: diffuseView, occlusion: white.view, ratio: targets.ratio, size }
  }
  const denoised = runDenoise(
    device,
    encoder,
    state,
    inputs,
    'indirect',
    targets.ratio,
    { a: diffuseView, b: occlusionView },
    denoiseRun(rt, values.screenGiDenoiserSamples, 0, values.screenGiDenoiserTemporal),
  )
  return {
    diffuse: denoised.a,
    occlusion: denoised.b,
    ratio: targets.ratio,
    size,
  }
}

/** A texture of `size` texels all ones: the occlusion of an indirect light that is not denoised. */
function whiteOcclusion(device: GPUDevice, size: readonly [number, number]) {
  const texture = device.createTexture({
    label: 'Trillion3D screen diffuse occlusion (none)',
    size: [size[0], size[1]],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture },
    new Float32Array(size[0] * size[1]).fill(1),
    { bytesPerRow: size[0] * 4 },
    [size[0], size[1]],
  )
  return { texture, view: texture.createView() }
}

/** Frees what the screen-space traces kept for a view's `gpu`, and the view uniform the passes beside them made where the traces made none (the shadow denoiser's own is let go with its state, `releaseBesideInputs`). Retired, never destroyed at once: the commands of this image already encoded may still name them. */
export function releaseScreenSpaceTracing(gpu: { viewKey?: object }) {
  const key = viewKey(gpu)
  const state = held.get(key)
  if (state) retire(state.device, { destroy: () => releaseHeld(state) })
  held.delete(key)
  releaseBesideInputs(gpu, 'traces')
}

/** Frees the view uniform one kind of pass beside the traces made for a view (`kept`: the shadow denoiser's, let go with its state). Retired (at once where the device was replaced). */
export function releaseBesideInputs(
  gpu: { viewKey?: object },
  side: 'traces' | 'kept',
  replaced = false,
) {
  const key = viewKey(gpu)
  const sides = beside.get(key)
  const mine = sides?.[side]
  if (!sides || !mine) return
  retire(mine.device, { destroy: () => mine.view.destroy() }, replaced)
  delete sides[side]
  if (!sides.traces && !sides.kept) beside.delete(key)
}
