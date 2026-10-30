import type { ScreenReflection } from '../../../lighting/reflections/gpu.ts'
import type { GpuPageCache } from '../../../geometry/pages/pool/pages.ts'
import type { createGpuPresenter } from '../../../gpu/core/presentation.ts'
import type { ComposeSource, createDeferredLighting } from '../../../lighting/deferred/deferred.ts'
import type { ComposedImage } from '../../../lighting/deferred/program.ts'
import type { OverlayFrame } from '../../../post/effects/webgpuKinds.ts'
import type { SurfaceBuffer } from '../../../materials/surface/surfaceBuffer.ts'
import type { Responsive } from '../../../blend/responsive.ts'
import type { DisplayFilter } from '../../../blend/display/displayFilter.ts'
import type { TranslucencyTargets } from '../../../blend/translucency.ts'
import type { TemporalAntialiasing } from '../../../post/taa/temporalAntialiasing.ts'
import type { Velocity } from '../../../post/taa/velocity.ts'
import type { ScreenProbeView } from '../../../lighting/bounce/screen/view.ts'
import type { AmbientOcclusion } from '../../../lighting/ao/frame.ts'
import type { SubsurfaceScattering } from '../../../lighting/subsurface/frame.ts'
import { createKindSettings, type KindSettings } from '../../../post/effects/kindSettings.ts'
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
import type { FogSeparateState } from '../../render/encodeFogSeparate.ts'
import type { TranslucencyVolumeState } from '../../../lighting/translucency/frame.ts'
import type { TranslucencyGiState } from '../../../lighting/translucencyGi/gpu.ts'
import { localFogBytes, type LocalFogGpu } from '../../render/localFogGpu.ts'
import type { LightShaftsGpu } from '../../../modules/sky/lightShafts/frame.ts'
import type { CloudViewGpu } from '../../../modules/sky/clouds/viewTargets.ts'
import type { HairViewGpu } from '../../../hair/viewGpu.ts'

/** GPU resources of the image: page cache, frame targets and presentation. */
/** What an image composed onto the canvas alone was composed from (`composePass`'s arguments). */
interface CanvasOnly {
  clear: GPUColor
  composed: ComposedImage | undefined
  asIs: boolean
  source: ComposeSource
}

/** The images the passes after the lighting hand on, each rewritten by every image of the view: an image
 *  allocates none. They name the view's own textures, so they are the view's, never a module's — a
 *  second world, or view, would write its views into the ones the first keeps (`canvasOnly`). */
export interface ImageScratch {
  composed: ComposedImage
  resolved: ComposedImage & { half?: GPUTextureView }
  late: ComposedImage & { half?: GPUTextureView }
  overlay: OverlayFrame
}

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
  /** Set where the last image was composed straight onto the canvas, the display texture not
   *  written: what it was composed from, to compose it again into the display texture for a reader
   *  (`../../io/displayRead.ts`). Undefined where the display texture holds the image; it goes
   *  with the targets it names. */
  canvasOnly: CanvasOnly | undefined
  /** The images the passes after the lighting hand on (`ImageScratch`). */
  images: ImageScratch
  /** What transparents ask of virtual textures, one tile rank per pixel: a target, never a fragment-
   *  stage write, which would cost early-z reject. */
  feedbackTexture: GPUTexture | undefined
  feedbackView: GPUTextureView | undefined
  /** The distortion's targets: the copy of the opaque scene it rereads and the offsets it
   *  accumulates. A 1×1 texel while the scene carries no transmissive surface — the binding then
   *  exists without costing anything. */
  backdrop: TransmissionBackdrop | undefined
  /** The separate translucency: the targets the translucent layers are drawn into and composed from
   *  (`../../../blend/translucency.ts`), a texel each while the scene has none. */
  translucency: TranslucencyTargets | undefined
  /** The view's reflection: the opaque trace's target and its last lit
   *  image (`../../../lighting/reflections/gpu.ts`). */
  reflection: ScreenReflection | undefined
  surfaces: SurfaceBuffer | undefined
  /** The responsiveness the blends write for the temporal analysis
   *  (`../../prepare/responsiveTarget.ts`). */
  responsive: Responsive | undefined
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
  /** The view's screen-space subsurface scattering — its textures at the size its targets are made at, the profile table and the
   *  quality history —, made at the first image whose surfaces may carry a subsurface-profile pixel and given back when none do
   *  (`../../../lighting/subsurface/frame.ts`). */
  subsurface: SubsurfaceScattering | undefined
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
  /** The view's reading of the settings of the effect kinds (`../../../post/effects/kindSettings.ts`):
   *  another reading breaks the hold; made with the state, the chain's code not loaded yet. */
  kindSettings: KindSettings
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
  /** The fog drawn into textures of its own, made once a scene asks for it (`../../render/encodeFogSeparate.ts`). */
  fogSeparate?: FogSeparateState
  /** The translucency lighting volume, made once a scene's surfaces are lit from it
   *  (`../../../lighting/translucency/frame.ts`). */
  translucencyVolume?: TranslucencyVolumeState
  /** The translucency global illumination volume, made once a scene's see-through surfaces could read it
   *  (`../../../lighting/translucencyGi/frame.ts`). */
  translucencyGi?: TranslucencyGiState
  /** The lists of the local fog volumes over each tile of the view, in a buffer made for its tile grid
   *  while a view draws a volume (`../../render/localFogGpu.ts`). */
  localFog?: LocalFogGpu
  /** The view's light shafts: their images and histories, and the occlusion mask the fog reads,
   *  made at the first image that draws them (`../../../modules/sky/lightShafts/frame.ts`). */
  lightShafts?: LightShaftsGpu
  /** The view's clouds: the images they are traced and rebuilt into, with the state the rebuilding
   *  keeps, made at the first image that draws them (`../../render/encodeClouds.ts`). */
  clouds?: CloudViewGpu
  /** The view's hair strands: their visibility, macro groups and bounds, made at the first image that
   *  draws them (`../../../hair/frame.ts`). */
  hair?: HairViewGpu
  /** The key the view's own states are kept under (`./viewKey.ts`), traded with the view. */
  viewKey?: object
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

/** A view's image scratch, its images not yet drawn. */
export const createImageScratch = (): ImageScratch => ({
  composed: { color: undefined as unknown as GPUTextureView },
  resolved: {} as ImageScratch['resolved'],
  late: {} as ImageScratch['late'],
  overlay: {} as OverlayFrame,
})

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
    canvasOnly: undefined,
    images: createImageScratch(),
    feedbackTexture: undefined,
    feedbackView: undefined,
    backdrop: undefined,
    translucency: undefined,
    reflection: undefined,
    surfaces: undefined,
    responsive: undefined,
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
    subsurface: undefined,
    temporalLevel: DEFAULT_TEMPORAL_AA_LEVEL,
    exposure: undefined,
    finish: undefined,
    finishPending: false,
    effects: undefined,
    effectsRevision: 0,
    kindSettings: createKindSettings(),
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

/** The passes a view holds in targets beside the frame's own, the one list the funding and the
 *  view's metrics both count by (`viewPassBytes`). */
type ViewPassHolders = Partial<Pick<WebgpuGpuState, 'deferred'>> &
  Pick<
    WebgpuGpuState,
    | 'effects'
    | 'finish'
    | 'velocity'
    | 'screenProbes'
    | 'ambientOcclusion'
    | 'subsurface'
    | 'fogVolume'
    | 'fogSeparate'
    | 'translucencyVolume'
    | 'translucencyGi'
    | 'localFog'
    | 'lightShafts'
    | 'clouds'
    | 'hair'
  >

/** Bytes of the passes a view holds in targets: its effect chain's, its finishing's, its velocity
 *  stage's, its screen probes', its ambient occlusion's, its subsurface's, its fog's, its
 *  translucency volumes', its local fog's, its light shafts', its clouds', its hair strands' and,
 *  where `deferred` is given, its tone table's. The table is the session's, not the view's
 *  (`VIEW_GPU_KEYS` holds no `deferred`): the state of the view drawn has it, the share a view
 *  keeps aside while another is drawn has none. */
export const viewPassBytes = (gpu: ViewPassHolders) =>
  (gpu.effects?.bytes ?? 0) +
  (gpu.finish?.bytes ?? 0) +
  (gpu.velocity?.bytes ?? 0) +
  (gpu.screenProbes?.bytes ?? 0) +
  (gpu.ambientOcclusion?.bytes ?? 0) +
  (gpu.subsurface?.bytes ?? 0) +
  (gpu.fogVolume?.bytes ?? 0) +
  (gpu.fogSeparate?.bytes ?? 0) +
  (gpu.translucencyVolume?.bytes ?? 0) +
  (gpu.translucencyGi?.bytes ?? 0) +
  localFogBytes(gpu) +
  (gpu.lightShafts?.bytes ?? 0) +
  (gpu.clouds?.bytes ?? 0) +
  (gpu.hair?.bytes ?? 0) +
  (gpu.deferred?.toneLut.bytes ?? 0)

/** Bytes of a view's frame targets: those it made and its passes' (`viewPassBytes`). */
export const viewTargetBytes = (gpu: ViewPassHolders & Pick<WebgpuGpuState, 'targetBytes'>) =>
  gpu.targetBytes + viewPassBytes(gpu)
