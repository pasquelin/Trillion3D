import { SAMPLED_LIGHTS_RULES } from '../../../../sdk-core/src/contracts/sampledLightsOptions.ts'
import {
  resolveSettings,
  resolveSettingsStamped,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import { noiseFrame } from '../../frame/render/noiseFrame.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { screenProbeVectors } from '../bounce/screen/vectorSource.ts'
import { NO_CAMERA, previousCameraOf } from '../../frame/backend/state/previousCamera.ts'
import { reflectionGroup, reflectionLightView } from '../reflections/group.ts'
import { skyLightReadOf } from '../../frame/render/skyLightState.ts'
import { SHADOW_RULES } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { surfaceHitReads } from '../surfaceCache/frame.ts'
import { blueNoiseNow } from '../../gpu/noise/blueNoiseTextures.ts'
import { CUTS, FULL_CONTRACT, type ContractKey } from '../deferred/contractCuts.ts'
import type { DirectLightResources } from '../deferred/program.ts'
import type { SampledLightsSettings } from './parameters.ts'
import { createLightPower } from './lightPower.ts'
import { lightFunctionResources } from '../lightFunction/frame.ts'
import { createSampledLights, type SampledSamples, type SampledSurface } from './sampledLights.ts'
import { frontStamp } from '../reflections/frontLayer.ts'
import { SAMPLED_GROUP } from './layout.ts'
import type { VsmMarkingFrontSamples, VsmMarkingSamples } from '../shadows/vsm/markingPass.ts'
import { FRONT_MARK } from './frontLightWgsl.ts'

/** The view's sampled lighting settings, read by the stamped reader into this one object (an image where no setting was written costs a compare). */
const settings: SampledLightsSettings = resolveSettings(SAMPLED_LIGHTS_RULES, {})

/** The view's sampled lighting settings, read now. */
export function followSampledLights(rt: WebgpuPagesRuntime): SampledLightsSettings {
  resolveSettingsStamped(SAMPLED_LIGHTS_RULES, rt.context, settings)
  return settings
}

/** Whether the sampled lighting lights the nearest translucent layer (`sampledLightsFrontLayer`): it is on, whatever the directional lights do (the layer's mark says whether its light holds them). */
export function lightsFrontLayer(rt: WebgpuPagesRuntime) {
  const values = followSampledLights(rt)
  return values.sampledLights && values.sampledLightsFrontLayer
}

/** Whether the nearest translucent layer is to be drawn before the shadow maps' pages are marked: the samples of the layer mark them too. */
export function drawsFrontBeforeSampledMarking(rt: WebgpuPagesRuntime) {
  const values = followSampledLights(rt)
  return marksPagesFromSamples(values) && values.sampledLightsFrontLayer
}

/**
 * The cuts the sampling's programs are made for: the lit image's (`CUTS`), the sampled ones apart (the programs that sample and shade light no light by the way they are lit).
 * `volumeShadow` is not read either: the sampled lighting reads no volume shadow, so the key keeps it false.
 */
const CUT_FIELDS = [
  'narrow',
  ...CUTS.filter((cut) => cut !== 'sampled' && cut !== 'sampledSun' && cut !== 'volumeShadow'),
] as const

/** The frame's key, every cut the lit image's resources name, the missing ones taken as the program with every code path. */
const keyOf = (direct: DirectLightResources): ContractKey => {
  const key: ContractKey = { ...FULL_CONTRACT, sampled: false, sampledSun: false }
  for (const cut of CUT_FIELDS) key[cut] = direct[cut] ?? key[cut]
  return key
}

/** Whether the last image of a runtime was lit with the sampled light: only then do the lit passes leave the lights to it. */
const lit = new WeakMap<WebgpuPagesRuntime, boolean>()

/**
 * The sampled cuts of the key of the opaque lit passes (`contractKey`): the local lights' pass adds the light the sampled lighting left in place of walking the lights, and the sun's
 * lights none, once the sampled lighting has lit an image (so that a frame in which it could not run is lit by the passes it leaves, never by none).
 */
export function sampledLightsKey(
  rt: WebgpuPagesRuntime,
  opaque: boolean,
  key: { sampled?: boolean; sampledSun?: boolean },
) {
  const values = followSampledLights(rt)
  const on = opaque && values.sampledLights && lit.get(rt) === true
  key.sampled = on
  key.sampledSun = on && values.sampledLightsDirectional
}

const kits = new WeakMap<GPUDevice, ReturnType<typeof createSampledLights>>()

/** The sampled lighting of a device, made at its first image. */
function kitOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  let kit = kits.get(device)
  if (!kit) {
    kit = createSampledLights(device, (error) =>
      rt.diag.diagnosticFailure('sampled-lights-program-failed', error),
    )
    kits.set(device, kit)
  }
  return kit
}

/**
 * Encodes the first lot of the sampled lighting for the image about to be lit (`createSampledLights`): the tiles of its surfaces by mode, the
 * lights drawn for each downsampled pixel, the hash of the lights each tile saw. Nothing while the view does not light with it, or while the
 * frame lacks the resources (the device, the surfaces, the depth, the lights, the blue noise) or a pipeline compiles. Returns the samples the
 * later passes trace and shade. `direct` is what the lit image binds (`directLightResources`), after `deferred.bind`.
 */
function sampledInputs(
  rt: WebgpuPagesRuntime,
  direct: DirectLightResources,
  values: SampledLightsSettings,
  target?: { surface: SampledSurface; depth: GPUTextureView },
) {
  const { device, surfaces, deferred, depthView } = rt.gpu
  if (!device || !surfaces || !deferred || !depthView || !direct.lights) return undefined
  const noise = blueNoiseNow(device)
  const power = powerOf(rt)
  if (!noise || !power) return undefined
  const key = keyOf(direct)
  const hizDepth = rt.vis.gpuHiz?.depth()
  const lightView = reflectionLightView(rt)
  const reflection =
    rt.gpu.reflection && hizDepth && lightView
      ? reflectionGroup(rt.gpu.reflection, hizDepth, lightView, skyLightReadOf(rt))
      : undefined
  const { placeholders } = deferred
  const [width, height] = rt.gpu.targetSize
  return {
    device,
    inputs: {
      surface: target?.surface ?? surfaces,
      depth: target?.depth ?? depthView,
      view: deferred.uniform,
      lights: direct.lights,
      tiles: direct.tiles ?? placeholders.tiles,
      sunRanks: direct.sunRanks ?? placeholders.sunRanks,
      lightFunction: direct.lightFunction ?? placeholders.lightFunction,
      lightProfile: direct.lightProfile ?? placeholders.lightProfile,
      noise: noise.view,
      reflection,
      vsm: direct.vsm,
      image: rt.run.frame,
      classicShadows: !readSetting(SHADOW_RULES, rt.context, 'shadowVirtualEnable'),
      field: surfaceHitReads(rt, device).field,
      // The nearest translucent layer has no motion vectors: it is reprojected by the camera's motion alone.
      vectors: target ? undefined : screenProbeVectors(rt),
      previousViewProjection: (previousCameraOf(rt).image > 0 ? previousCameraOf(rt) : NO_CAMERA)
        .viewProjection,
      key,
      settings: values,
      input: target ? ('frontTranslucency' as const) : ('surface' as const),
      width,
      height,
      frame: noiseFrame(rt),
      lightCount: rt.lights.store.count,
      power,
      hairVoxels: hairVoxelsOf(rt, values),
    },
  }
}

/** The strands' voxels the surfaces' rays are marched through (`sampledLightsHairVoxelTraces`), none where the view holds no hair or no volume of it. */
function hairVoxelsOf(rt: WebgpuPagesRuntime, values: SampledLightsSettings) {
  const hair = rt.gpu.hair
  const set = hair?.voxel.set
  const settings = hair?.inputs.voxel
  return values.sampledLightsHairVoxelTraces && hair?.visible && set && settings
    ? { set, settings }
    : undefined
}

/** Whether the view's shadow maps are asked for their pages by the samples: the sampled lighting is on, shadows its lights by the maps, and marks them from the samples alone. */
const marksPagesFromSamples = (values: SampledLightsSettings) =>
  values.sampledLights &&
  values.sampledLightsShadowMethod === 'virtualShadowMap' &&
  values.sampledLightsVsmMarkPages

/** The image whose samples phase was encoded before the shadow maps, per runtime, with what that phase left. */
const early = new WeakMap<WebgpuPagesRuntime, { frame: number; samples: SampledSamples }>()
/** The same for the nearest translucent layer, once the front pass wrote it. */
const earlyFront = new WeakMap<WebgpuPagesRuntime, { frame: number; samples: SampledSamples }>()

/** The sampled lighting of the nearest translucent layer, a device's own (its histories are the layer's). */
const frontKits = new WeakMap<GPUDevice, ReturnType<typeof createSampledLights>>()

/** The layer as the sampled lighting reads it, where the front pass wrote it this image as a surface (`FrontLayer.surfaceFrom`). */
function frontTarget(rt: WebgpuPagesRuntime) {
  const front = rt.gpu.reflection?.front
  const surface = front?.surface
  const opaque = rt.gpu.surfaces
  if (!front || !surface || !opaque || front.surfaced !== frontStamp(rt.run.frame)) return undefined
  return {
    front,
    surface,
    target: {
      depth: front.views.depth,
      surface: {
        stores: () => [surface.coloursView, surface.wordsView] as const,
        views: () => opaque.views(),
        subsurfaceView: opaque.subsurfaceView,
        lobesView: front.views.lobes,
      },
    },
  }
}

/** The layer's own kit, made at its first image. */
function frontKitOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  let kit = frontKits.get(device)
  if (!kit)
    frontKits.set(
      device,
      (kit = createSampledLights(
        device,
        (error) => rt.diag.diagnosticFailure('sampled-lights-program-failed', error),
        true,
      )),
    )
  return kit
}

/**
 * The samples phase of the sampled lighting, encoded BEFORE the shadow maps are marked and drawn (`encodeDirectLights`), where the samples mark the pages of the maps of
 * the lights they drew (`marksPagesFromSamples`); nothing otherwise, and the whole of the lighting is then encoded in the lit image (`encodeSampledLights`). The nearest
 * translucent layer's samples too, where the front pass wrote the layer before the marking (`drawsFrontBeforeSampledMarking`).
 */
export function encodeSampledSamples(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  direct: DirectLightResources,
) {
  const values = followSampledLights(rt)
  if (!marksPagesFromSamples(values)) return
  const made = sampledInputs(rt, direct, values)
  if (made) {
    const samples = kitOf(rt, made.device).encode(encoder, made.inputs, 'samples')
    if (samples) early.set(rt, { frame: made.inputs.frame, samples })
  }
  const layer = values.sampledLightsFrontLayer && frontTarget(rt)
  const madeFront = layer && sampledInputs(rt, direct, values, layer.target)
  if (!madeFront) return
  const samples = frontKitOf(rt, madeFront.device).encode(encoder, madeFront.inputs, 'samples')
  if (samples) earlyFront.set(rt, { frame: madeFront.inputs.frame, samples })
}

/** The samples a marking marks pages from: their texture and parameters, and the workgroups that cover them. */
function markingOf({ geometry, samples, params }: SampledSamples) {
  return {
    texture: samples,
    params,
    workgroups: [
      Math.ceil(geometry.sampleView[0] / SAMPLED_GROUP),
      Math.ceil(geometry.sampleView[1] / SAMPLED_GROUP),
    ] as [number, number],
  }
}

/** The samples the shadow maps' marking marks pages from this image, none when the samples phase was not encoded before them. */
export function sampledMarkingSamples(rt: WebgpuPagesRuntime): VsmMarkingSamples | undefined {
  const held = early.get(rt)
  if (!held || held.frame !== noiseFrame(rt)) return undefined
  return markingOf(held.samples)
}

/** The nearest translucent layer's samples the marking marks pages from this image, with the layer's depth they stand on; none when its samples phase was not encoded before the marking. */
export function sampledMarkingFrontSamples(
  rt: WebgpuPagesRuntime,
): VsmMarkingFrontSamples | undefined {
  const held = earlyFront.get(rt)
  const front = rt.gpu.reflection?.front
  if (!held || !front || held.frame !== noiseFrame(rt)) return undefined
  return { ...markingOf(held.samples), depth: front.views.depth }
}

/**
 * Encodes the passes of the sampled lighting still to encode for the image about to be lit: all of them, or, the samples phase having been encoded before the shadow maps
 * (`encodeSampledSamples`), the traces' and the hash. Nothing while the view does not light with it, or while the frame lacks the resources (the device, the surfaces, the depth,
 * the lights, the blue noise) or a pipeline compiles. Returns the samples the later passes shade. `direct` is what the lit image binds (`directLightResources`).
 */
export function encodeSampledLights(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  direct: DirectLightResources,
): SampledSamples | undefined {
  const values = followSampledLights(rt)
  direct.sampledLight = undefined
  if (!values.sampledLights) {
    lit.delete(rt)
    return undefined
  }
  const made = sampledInputs(rt, direct, values)
  const done = sampledMarkingSamples(rt)
  const result =
    made && kitOf(rt, made.device).encode(encoder, made.inputs, done ? 'traces' : 'all')
  lit.set(rt, !!result)
  direct.sampledLight = result?.composite
  return result
}

/**
 * Encodes the sampled lighting of the nearest translucent layer (`sampledLightsFrontLayer`), after the transparents' front pass wrote the layer as a surface (`FrontLayer.surfaceFrom`):
 * the layer's colour, normal, flags and depth lit as the opaque surfaces are, its own histories. Nothing while the layer is not lit by it, or the pass did not write the layer this image.
 * The layer's light is left where the blend's fragments read it (`frontLightWgsl.ts`), with a mark that says what it holds: no diffuse light where the layer keeps the specular light alone
 * (the translucency volume's diffuse light is then added), no sun where the directional lights do not join the sampling (the forward loop lights the layer with them).
 */
export function encodeSampledFront(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  direct: DirectLightResources,
) {
  const values = followSampledLights(rt)
  const layer = values.sampledLights && values.sampledLightsFrontLayer && frontTarget(rt)
  if (!layer) return
  const made = sampledInputs(rt, direct, values, layer.target)
  if (!made) return
  const kit = frontKitOf(rt, made.device)
  const done = earlyFront.get(rt)
  const result = kit.encode(
    encoder,
    made.inputs,
    done?.frame === made.inputs.frame ? 'traces' : 'all',
  )
  const mark =
    FRONT_MARK.lit +
    (values.sampledLightsFrontLayerSpecularOnly ? FRONT_MARK.specularOnly : 0) +
    (values.sampledLightsDirectional ? 0 : FRONT_MARK.sunsApart)
  // The layer's light goes where the blend's fragments read it (`frontLightWgsl.ts`): the second half of the front's traced radiance.
  if (result)
    kit.packFrontLight(
      encoder,
      result.composite,
      layer.surface.wordsView,
      layer.front.views.traced,
      [made.inputs.width, made.inputs.height],
      mark,
    )
}

/** The change of each light's power (`lightPower.ts`) of a device, and the ratios of the image being encoded, per runtime. */
const powers = new WeakMap<GPUDevice, ReturnType<typeof createLightPower>>()
const ratiosOf = new WeakMap<WebgpuPagesRuntime, { image: number; buffer: GPUBuffer }>()

/**
 * Measures the change of each light's power since the image before, once an image, before anything that samples the lights reads it (the surfaces' draw, the volume's): the ratios are
 * then this image's, as the reference computes them at the head of its frame. Nothing while the sampled lighting is off or the pass compiles.
 */
export function encodeLightPower(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  eye: ArrayLike<number>,
  pre: { now: number; exposure: number },
) {
  const values = followSampledLights(rt)
  const { device, deferred } = rt.gpu
  const buffer = rt.lights.buffer
  if (!values.sampledLights || !device || !deferred || !buffer) return
  let power = powers.get(device)
  if (!power)
    powers.set(
      device,
      (power = createLightPower(device, (error) =>
        rt.diag.diagnosticFailure('sampled-lights-program-failed', error),
      )),
    )
  const ratios = power.encode(encoder, {
    image: rt.run.frame,
    lights: buffer,
    lightCount: rt.lights.store.count,
    lightFunction:
      lightFunctionResources(rt, 'lightFunctionDeferred') ?? deferred.placeholders.lightFunction,
    eye,
    preExposure: pre.now,
    exposure: pre.exposure,
    measured: values.sampledLightsPowerDelta,
    lightFunctions: values.sampledLightsPowerDeltaLightFunctions,
  })
  if (ratios) ratiosOf.set(rt, { image: rt.run.frame, buffer: ratios })
  else ratiosOf.delete(rt)
}

/** The ratios of this image's lights' power, none before they are measured. */
export const powerOf = (rt: WebgpuPagesRuntime) => {
  const held = ratiosOf.get(rt)
  return held && held.image === rt.run.frame ? held.buffer : undefined
}

/** Frees the sampled lighting of a device (a session's dispose). */
export function disposeSampledLights(device: GPUDevice) {
  powers.get(device)?.dispose()
  powers.delete(device)
  kits.get(device)?.dispose()
  kits.delete(device)
  frontKits.get(device)?.dispose()
  frontKits.delete(device)
}
