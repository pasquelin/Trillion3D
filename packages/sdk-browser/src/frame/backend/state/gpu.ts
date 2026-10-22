import type { ScreenReflection } from '../../../lighting/reflections/gpu.ts'
import type { GpuPageCache } from '../../../geometry/pages/pool/pages.ts'
import type { createGpuPresenter } from '../../../gpu/core/presentation.ts'
import type { createDeferredLighting } from '../../../lighting/deferred/deferred.ts'
import type { SurfaceBuffer } from '../../../materials/surface/surfaceBuffer.ts'
import type { AsIsShare } from '../../../lighting/deferred/asIsShare.ts'
import type { DisplayFilter } from '../../../blend/display/displayFilter.ts'
import type { TemporalAntialiasing } from '../../../post/taa/temporalAntialiasing.ts'
import type { Velocity } from '../../../post/taa/velocity.ts'
import type { ScreenProbeView } from '../../../lighting/bounce/screen/view.ts'
import type { AmbientOcclusion } from '../../../lighting/ao/frame.ts'
import type { BlurWatch, DepthOfFieldWatch } from '../../../post/effects/blurPlan.ts'
import type { BloomWatch } from '../../../post/effects/bloom/bloomSettings.ts'
import type { ExposureMeter } from '../../../post/exposure/meter.ts'
import type { Finish } from '../../../post/finish/finish.ts'
import { isTaaLevelOn } from '../../../post/taa/levels.ts'
import {
  DEFAULT_TEMPORAL_AA_LEVEL,
  type TemporalAntialiasingLevel,
} from '../../../../../sdk-core/src/contracts/compilerAbi.ts'
import type { WebgpuEffects } from '../../../post/effects/webgpuEffects.ts'
import type { WebgpuGuidePass } from '../../../guides/guidePass.ts'
import type { WebgpuParticles } from '../../../particles/gpu/webgpuParticles.ts'
import type { TargetGrant } from '../../prepare/targetsSet.ts'
import type { FrameDifference } from '../../render/frameDifference.ts'
import type { AtmosphereGpu } from '../../../lighting/atmosphere/gpu.ts'
import type { FogVolumeState } from '../../render/encodeFogVolume.ts'

/** GPU resources of the image: page cache, frame targets and presentation. */
export interface WebgpuGpuState {
  /** The session's handle on the device (`gpu/core/deviceOwners.ts`), from `prepare`: everything
   *  the session creates goes through it, so that the labels name the session. */
  device: GPUDevice | undefined
  cache: GpuPageCache | undefined
  colorTexture: GPUTexture | undefined
  depthTexture: GPUTexture | undefined
  colorView: GPUTextureView | undefined
  depthView: GPUTextureView | undefined
  hdrTexture: GPUTexture | undefined
  hdrView: GPUTextureView | undefined
  /** The display colour composition writes, guides draw over and presentation shows: the colour
   *  target itself at native size, a target of the display's size when the frame is drawn below
   *  it (`../../prepare/targets.ts`). */
  displayTexture: GPUTexture | undefined
  displayView: GPUTextureView | undefined
  /** What transparents ask of virtual textures, one tile rank per pixel: a target, never a fragment-
   *  stage write, which would cost early-z reject. */
  feedbackTexture: GPUTexture | undefined
  feedbackView: GPUTextureView | undefined
  /** The distortion's targets: the copy of the opaque scene it rereads and the offsets it
   *  accumulates. A 1×1 texel while the scene carries no transmissive surface — the binding then
   *  exists without costing anything. */
  backdrop: TransmissionBackdrop | undefined
  /** The view's reflection: the opaque trace's target and the radiance pyramid of its last lit
   *  image (`../../../lighting/reflections/gpu.ts`). */
  reflection: ScreenReflection | undefined
  surfaces: SurfaceBuffer | undefined
  asIsShare: AsIsShare | undefined
  /** The display filter, made by the first image whose blends filter and kept while the plan
   *  holds such a blend (`../../../blend/display/displayFilter.ts`). */
  displayFilter: DisplayFilter | undefined
  /** The size every pass up to the temporal resolve draws at, this image: the display's, or below
   *  it, in the top-left of the render targets (`renderScale.ts`, `drawFrameAt`). */
  targetSize: [number, number]
  /** The size the render targets are made at: the largest `targetSize` a scale change draws at
   *  without remaking them. */
  allocatedSize: [number, number]
  /** The size the resolve, the effect chain, composition, guides and presentation run at, and
   *  what decides detail reads: the host's viewport when the targets were made. */
  displaySize: [number, number]
  /** Bytes of the image targets of this size, those the image budget admitted. */
  targetBytes: number
  /** The frame targets asked of the device (`targetGrant.ts`): in flight, or settled when refused
   *  at that size; gone once granted — once swapped in, made aside. */
  targetGrant: TargetGrant | undefined
  zeroUv: GPUBuffer | undefined
  presenter: ReturnType<typeof createGpuPresenter> | undefined
  deferred: Awaited<ReturnType<typeof createDeferredLighting>> | undefined
  /** Temporal-antialiasing pass and its two history targets; absent when the host refuses it or the
   *  device does not host it. */
  temporal: TemporalAntialiasing | undefined
  /** The velocity stage: the motion of the render texels, which the passes that read it share —
   *  the indirect light, the temporal pass, the motion blur; made at the first image that asks
   *  (`../../../post/taa/velocityFrame.ts`). */
  velocity: Velocity | undefined
  /** The view's screen probes — the pixels' indirect light, at the size its targets are made at —, made at the first image
   *  that casts them and given back with a level `'off'` (`../../../lighting/bounce/screen/view.ts`). */
  screenProbes: ScreenProbeView | undefined
  /** The view's screen-space ambient occlusion — its textures at the size its targets are made at, and what the lighting
   *  reads this image —, made at the first image that draws it and given back when none does
   *  (`../../../lighting/ao/frame.ts`). */
  ambientOcclusion: AmbientOcclusion | undefined
  /** The level the host wants the pass at (`../../../post/taa/levels.ts`), `'off'` none: set at
   *  preparation, then by `setTemporalAntialiasing` (`taaWanted`). */
  temporalLevel: TemporalAntialiasingLevel
  /** The view's automatic exposure, made at the first image lit by declared lamps whose exposure
   *  is `'auto'` (`../../../post/exposure/frame.ts`). */
  exposure: ExposureMeter | undefined
  /** The display finishing's scene chain, local exposure and uniform, made at the first image
   *  lit by declared lamps (`../../../post/finish/frame.ts`). */
  finish: Finish | undefined
  /** Whether the last image was drawn without a finishing its composition did not compile yet:
   *  the view is drawn again once it has. */
  finishPending: boolean
  /** The effect chain's targets and programs, made at the first frame with a pass. */
  effects: WebgpuEffects | undefined
  /** Revision of the chain the last encoded image drew, -1 while its programs compile: another
   *  one breaks the hold. */
  effectsRevision: number
  /** The view's reading of the motion blur's settings (`MOTION_BLUR_RULES`): another reading breaks
   *  the hold (`../../../post/effects/blurPlan.ts`); none before the first image. */
  motionBlurWatch: BlurWatch | undefined
  /** The same for the depth of field's settings (`DEPTH_OF_FIELD_RULES`). */
  depthOfFieldWatch: DepthOfFieldWatch | undefined
  /** The view's reading of the bloom's settings (`BLOOM_RULES`): another reading breaks the hold
   *  (`../../../post/effects/bloom/bloomSettings.ts`); none before the first image. */
  bloomWatch: BloomWatch | undefined
  /** The guide pass, built by the first image that shows a guide (`guidePass.ts`). */
  guides: WebgpuGuidePass | undefined
  /** Revision of the page's guides the last encoded image drew (`encodeGuides.ts`). */
  guideRevision: number
  /** The particle step, made by the first image with a pool (`../../../particles/gpu/`). */
  particles: WebgpuParticles | undefined
  /** The frame-difference view's previous image and pass, made while that view is chosen alone
   *  (`../../render/frameDifference.ts`). */
  frameDifference?: FrameDifference
  /** The scene's atmosphere: its tables, passes and the sky's capture, made once a scene declares
   *  one (`../../render/encodeAtmosphere.ts`). */
  atmosphere?: AtmosphereGpu
  /** The scene's fog volume and cubemap, made once a scene turns the volume on or sets a cubemap
   *  (`../../render/encodeFogVolume.ts`). */
  fogVolume?: FogVolumeState
}

/** The copy of the opaque scene the distortion rereads and the offsets it accumulates, with their
 *  views (`../../../blend/transparent/transmission.ts`). */
export interface TransmissionBackdrop {
  color: GPUTexture
  colorView: GPUTextureView
  distortion: GPUTexture
  distortionView: GPUTextureView
  /** True when the copies are at the target size and the copy is worth it. */
  active: boolean
}

/** Whether the host wants a view's temporal pass: any level but off (`temporalLevel`). */
export const taaWanted = (gpu: Pick<WebgpuGpuState, 'temporalLevel'>) =>
  isTaaLevelOn(gpu.temporalLevel)

export function createWebgpuGpuState(viewport: readonly [number, number]): WebgpuGpuState {
  return {
    device: undefined,
    cache: undefined,
    colorTexture: undefined,
    depthTexture: undefined,
    colorView: undefined,
    depthView: undefined,
    hdrTexture: undefined,
    hdrView: undefined,
    displayTexture: undefined,
    displayView: undefined,
    feedbackTexture: undefined,
    feedbackView: undefined,
    backdrop: undefined,
    reflection: undefined,
    surfaces: undefined,
    asIsShare: undefined,
    displayFilter: undefined,
    targetSize: [viewport[0] ?? 1, viewport[1] ?? 1],
    allocatedSize: [viewport[0] ?? 1, viewport[1] ?? 1],
    displaySize: [viewport[0] ?? 1, viewport[1] ?? 1],
    targetBytes: 0,
    targetGrant: undefined,
    zeroUv: undefined,
    presenter: undefined,
    deferred: undefined,
    temporal: undefined,
    velocity: undefined,
    screenProbes: undefined,
    ambientOcclusion: undefined,
    temporalLevel: DEFAULT_TEMPORAL_AA_LEVEL,
    exposure: undefined,
    finish: undefined,
    finishPending: false,
    effects: undefined,
    effectsRevision: 0,
    motionBlurWatch: undefined,
    depthOfFieldWatch: undefined,
    bloomWatch: undefined,
    guides: undefined,
    guideRevision: 0,
    particles: undefined,
    frameDifference: undefined,
  }
}

/** `gpu`'s grant while it holds the frames: asked the held way, in flight or refused. Targets made
 *  aside hold none — the frames draw into those in place meanwhile. */
export const heldTargetGrant = (gpu: Pick<WebgpuGpuState, 'targetGrant'>) =>
  gpu.targetGrant?.mode === 'held' ? gpu.targetGrant : undefined

/** `gpu`'s surfaces `old` replaced by `next`, one target of theirs remade: its frame-target bytes
 *  follow. */
export function swapSurfaces(
  gpu: Pick<WebgpuGpuState, 'surfaces' | 'targetBytes'>,
  old: SurfaceBuffer,
  next: SurfaceBuffer,
) {
  gpu.surfaces = next
  gpu.targetBytes += next.allocationBytes - old.allocationBytes
}

/** Bytes of a view's frame targets: those it made, its effect chain's, its finishing's, its
 *  velocity stage's, its screen probes', its ambient occlusion's and its fog's. */
export const viewTargetBytes = (
  gpu: Pick<
    WebgpuGpuState,
    | 'targetBytes'
    | 'effects'
    | 'finish'
    | 'velocity'
    | 'screenProbes'
    | 'ambientOcclusion'
    | 'fogVolume'
  >,
) =>
  gpu.targetBytes +
  (gpu.effects?.bytes ?? 0) +
  (gpu.finish?.bytes ?? 0) +
  (gpu.velocity?.bytes ?? 0) +
  (gpu.screenProbes?.bytes ?? 0) +
  (gpu.ambientOcclusion?.bytes ?? 0) +
  (gpu.fogVolume?.bytes ?? 0)
