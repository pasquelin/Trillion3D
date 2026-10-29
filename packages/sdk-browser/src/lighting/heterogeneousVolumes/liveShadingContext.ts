import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import {
  readHeterogeneousVolumeSetting,
  type HeterogeneousVolumeField,
} from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import { type ResolvedHeterogeneousVolume } from '../../../../sdk-core/src/scene/heterogeneousVolume/contracts.ts'
import { type EngineCamera } from '../../camera/engineCamera.ts'
import { cameraForward } from '../../camera/forward.ts'
import { type WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { viewProj } from '../../frame/backend/helpers.ts'
import { fogReadOf } from '../../frame/render/localFogGpu.ts'
import { directLightResources } from '../../frame/prepare/contractLight.ts'
import { writeClipDepth } from '../../gpu/core/selectionProjection.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { TAA_VIEW_BYTES } from '../../post/taa/bindingsWgsl.ts'
import { velocityTargetOf } from '../../post/taa/volumeVelocity.ts'
import { clearVolumeHoldout, volumeHoldoutOf } from '../../post/volumeHoldout.ts'
import { vsmOrStandIns } from '../shadows/vsm/frame/vsmConsumers.ts'
import { publishHeterogeneousCamera } from './cameraMap.ts'
import { createVolumeImage, downsampledSize } from './liveShadingGpu.ts'
import { beerFormatOf } from './beerShadowMapGpu.ts'
import { gridDebugModeOf, usesVoxelGrids } from './voxelGridSettings.ts'
import { storageBuffersOf } from './liveShadingResources.ts'
import { shadowSetup } from './liveShadingShadows.ts'
import {
  type State,
  ensureStandIns,
  compiledOf,
  dropHeld,
  placementOf,
  bufferOf,
  release,
  states,
  stepImage,
} from './liveShadingState.ts'
import { type SparseVolumes } from './sparseVolumeLoad.ts'
import { publishHeterogeneousShadowBuffer } from './volumeShadowRead.ts'

/** A setting of the heterogeneous volumes, as a number. */
type Settings = (field: HeterogeneousVolumeField) => number

/** The numbers of the camera the passes of an image share, rebuilt in place by each: the inverse of the matrix the depth was drawn with (the temporal jitter
 *  in it: the ray through a pixel centre is the jittered one), the camera's forward and the depth's law. */
export const frameView = {
  inverse: new Float64Array(16),
  forward: new Float64Array(3),
  depthMap: [0, 0] as [number, number],
}

/** Rebuilds `frameView` for the camera `cam`. */
function writeFrameView(cam: EngineCamera) {
  invertMatrix4(frameView.inverse, viewProj)
  cameraForward(frameView.forward, cam.world)
  writeClipDepth(frameView.depthMap, cam.projection)
}

/** Everything the passes of one image of the volumes share: the resources of the runtime, the settings and what they decide, the volumes placed, and the
 *  progress of the image (`first` while no volume has been drawn, `ping` the image of the two the next volume reads). */
export interface FrameContext {
  readonly rt: WebgpuPagesRuntime
  readonly device: GPUDevice
  readonly encoder: GPUCommandEncoder
  readonly cam: EngineCamera
  readonly held: State
  readonly sparse: SparseVolumes
  readonly shadowed: boolean
  readonly settings: Settings
  readonly target: NonNullable<State['targets']>
  readonly scaled: readonly [number, number]
  readonly factor: number
  readonly clocks: { time: number; realTime: number }
  readonly pre: ReturnType<typeof preExposureOf>
  readonly gi: NonNullable<WebgpuPagesRuntime['gpu']['translucencyGi']>['published'] | undefined
  readonly giView: GPUTextureView | undefined
  readonly scalability: number
  readonly fogMode: number
  readonly indirectMode: number
  readonly fogRead: NonNullable<ReturnType<typeof fogReadOf>>
  readonly vsm: ReturnType<typeof vsmOrStandIns>
  readonly velocity: ReturnType<typeof velocityTargetOf>
  readonly taaStand: GPUBuffer
  readonly shadow: ReturnType<typeof shadowSetup>
  readonly placed: ReturnType<typeof placementOf>[]
  readonly holdoutTarget: ReturnType<typeof volumeHoldoutOf>
  readonly useExistence: boolean
  readonly cameraMaps: [GPUTexture, GPUTexture] | undefined
  readonly beerFormat: GPUTextureFormat
  first: boolean
  ping: number
}

/** The state of the runtime for this image, none (and everything let go) where the scene has no volume or the settings turn them off, or while the sparse
 *  volumes' file is read. */
function heldStateOf(rt: WebgpuPagesRuntime, phase: 'shadows' | 'image') {
  const { gpu } = rt
  // The camera map is the image's own: made again by the image, or none.
  if (phase === 'image') publishHeterogeneousCamera(gpu, undefined)
  const store = rt.context.sceneHeterogeneousVolumes
  const found = states.get(gpu)
  if (
    !store?.count ||
    !readHeterogeneousVolumeSetting(rt, 'heterogeneousVolumes') ||
    !readHeterogeneousVolumeSetting(rt, 'heterogeneousVolumesAllowed')
  ) {
    if (found) release(found)
    publishHeterogeneousShadowBuffer(gpu, undefined)
    states.delete(gpu)
    return undefined
  }
  const reader = rt.context.sparseVolumesFile
  if (!reader || !gpu.hdrTexture || !gpu.hdrView || !gpu.depthView || !rt.lights.buffer)
    return undefined
  const held: State = found ?? {
    programs: new Map(),
    failed: false,
    uploads: new Map(),
    frames: new Map(),
    lastClock: 0,
    caches: new Map(),
    buffers: new Map(),
    steps: new Map(),
    maps: [],
  }
  states.set(gpu, held)
  if (!held.reading && !held.failed)
    held.reading = reader()
      .then((sparse) => {
        held.sparse = sparse
        rt.run.gate.resourcesChanged()
      })
      .catch((error: unknown) => {
        held.failed = true
        rt.diag.diagnosticFailure('sparse-volumes-load-failed', error)
      })
  return held.sparse ? { held, sparse: held.sparse, store } : undefined
}

/** Lets go of the maps the last image built for the volumes' shadows. */
function forgetShadows(rt: WebgpuPagesRuntime, held: State) {
  held.maps = []
  held.packedMaps = undefined
  publishHeterogeneousShadowBuffer(rt.gpu, undefined)
}

/**
 * Lets go of what an option that is now off left held: the baked textures and the boxes' hierarchy of the preshading, the voxel grids and the lists of the
 * shadows, the existence masks. (The occlusion's texture is let go of by its own pass.)
 */
function releaseSwitchedOff(held: State, settings: Settings, diagnostic: string) {
  const grids = usesVoxelGrids(settings) || gridDebugModeOf(diagnostic, settings) !== 0
  const shadows = !!settings('heterogeneousVolumesShadows')
  const preshading = !!settings('heterogeneousVolumesPreshading')
  const masks = !!settings('heterogeneousVolumesUseExistenceMask')
  const adaptive = settings('heterogeneousVolumesShadowsType') === 0
  const camera =
    !!settings('heterogeneousVolumesTranslucency') &&
    settings('heterogeneousVolumesComposition') === 0
  const lists = (key: string) => key.startsWith('avsm ')
  const beerMaps = (key: string) =>
    /^beer \d/.test(key) || /^beer map (\d|pack)/.test(key) || key === 'beer maps packed'
  if (!grids) held.voxelGrids = undefined
  dropHeld(
    held,
    (key) =>
      (!grids && key.startsWith('grid ')) ||
      (!shadows && (lists(key) || beerMaps(key))) ||
      (shadows && !adaptive && lists(key)) ||
      (!camera && key.startsWith('camera beer')) ||
      (!preshading &&
        (key.startsWith('bake:') || key.startsWith('min:') || key.includes(' sparse '))) ||
      (!masks && (key.startsWith('mask:') || key.startsWith('dilated:'))),
  )
}

/** The two images of the volumes at the downsampled size, made again where it moved. */
function ensureTargets(
  held: State,
  device: GPUDevice,
  scaled: readonly [number, number],
  factor: number,
) {
  if (!held.targets || held.targets.size[0] !== scaled[0] || held.targets.size[1] !== scaled[1]) {
    held.targets?.images.forEach((image) => image.destroy())
    held.targets = {
      size: scaled,
      factor,
      images: [
        createVolumeImage(device, scaled, 'Trillion3D heterogeneous volumes A'),
        createVolumeImage(device, scaled, 'Trillion3D heterogeneous volumes B'),
      ],
    }
  }
  return held.targets
}

/** The modes the scalability decides: below the highest the fog's in-scattering is the linear approximation and the indirect light the cache's (level 2) or none. */
function scalabilityModes(
  settings: Settings,
  scalability: number,
  giView: GPUTextureView | undefined,
) {
  const fogMode = scalability < 3 ? 2 : settings('heterogeneousVolumesFogInscattering')
  const indirectMode = !giView
    ? 0
    : scalability === 3
      ? settings('heterogeneousVolumesIndirectLightingMode')
      : scalability === 2
        ? 1
        : 0
  return { fogMode, indirectMode }
}

/** The volumes nearest first, where the setting sorts them, placed for this image. */
function placedVolumes(
  c: {
    held: State
    sparse: SparseVolumes
    values: Iterable<ResolvedHeterogeneousVolume>
    eye: ArrayLike<number>
    clocks: { realTime: number }
  },
  settings: Settings,
) {
  const dt = Math.max(c.clocks.realTime - (c.held.lastClock || c.clocks.realTime), 0)
  const volumes = [...c.values].filter(
    (volume) => volume.visible && volume.graph && c.sparse.volumeOfNode(volume.source),
  )
  const distance = (volume: ResolvedHeterogeneousVolume) => {
    const m = volume.matrix
    return Math.hypot(m[12] - c.eye[0], m[13] - c.eye[1], m[14] - c.eye[2])
  }
  if (settings('heterogeneousVolumesDepthSort')) volumes.sort((a, b) => distance(a) - distance(b))
  if (volumes.length) c.held.lastClock = c.clocks.realTime
  return volumes.map((volume) => placementOf(c.held, c.sparse, volume, dt))
}

/** The holdout the volumes that hold out add to, cleared once before the first of them: where the alpha holdout is in effect, a volume holds out and the
 *  device lets the program bind its fifth storage texture. */
function holdoutOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  placed: readonly ReturnType<typeof placementOf>[],
  shadowed: boolean,
) {
  const target =
    !shadowed &&
    placed.some((item) => item.volume.holdout) &&
    device.limits.maxStorageTexturesPerShaderStage >= 5
      ? volumeHoldoutOf(rt, device)
      : undefined
  if (target) clearVolumeHoldout(encoder, target)
  return target
}

/** Composited with the translucency, the march also writes the beer map of the camera (two images that alternate like the volumes' own), which the
 *  composition reads the transmittance at the scene's depth from (`HeterogeneousVolumesComposite.usf:26-35`, `:209`). */
function cameraMapsOf(
  held: State,
  device: GPUDevice,
  scaled: readonly [number, number],
  beerFormat: GPUTextureFormat,
  settings: Settings,
  shadowed: boolean,
) {
  return !shadowed &&
    settings('heterogeneousVolumesTranslucency') &&
    settings('heterogeneousVolumesComposition') === 0 &&
    beerFormat === 'rgba16float'
    ? ([0, 1].map((i) => stepImage(held, device, `camera beer ${i}`, scaled, beerFormat)) as [
        GPUTexture,
        GPUTexture,
      ])
    : undefined
}

/** What the passes read of the scene besides the volumes: the fog, the lights' shadow maps, the velocity vectors where the image writes them (the highest
 *  scalability alone, `LiveShadingPipeline.usf:396`) and the stand-in of the velocity's view. */
function sceneInputs(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  held: State,
  settings: Settings,
  scalability: number,
  shadowed: boolean,
) {
  const placeholders = rt.gpu.deferred!.placeholders
  return {
    fogRead: fogReadOf(rt) ?? placeholders.fog,
    vsm: vsmOrStandIns(directLightResources(rt).vsm, placeholders),
    velocity:
      scalability === 3 && !shadowed && settings('heterogeneousVolumesVelocity')
        ? velocityTargetOf(rt)
        : undefined,
    taaStand: bufferOf(
      held,
      device,
      'velocity view stand-in',
      TAA_VIEW_BYTES,
      GPUBufferUsage.UNIFORM,
    ),
  }
}

/**
 * Whether the shadows may be made as adaptive maps: the program that builds them binds one more storage buffer than the others, which a textured volume
 * on a device with 8 storage buffers a stage cannot. Where one volume cannot, every map of the image is a Beer map (the setting's fallback), and the
 * engine's diagnostics say so.
 */
function adaptiveFits(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  placed: readonly ReturnType<typeof placementOf>[],
  settings: Settings,
) {
  if (settings('heterogeneousVolumesShadowsType') !== 0) return true
  const fits = placed.every((item) => {
    const compiled = compiledOf(item.volume)
    return (
      !compiled ||
      storageBuffersOf(compiled.uses.textures, 'avsm') <=
        device.limits.maxStorageBuffersPerShaderStage
    )
  })
  if (!fits)
    rt.diag.diagnosticFailure(
      'heterogeneous-volume-adaptive-shadows-unavailable',
      new Error(
        'the device binds too few storage buffers a stage for the adaptive shadow map of a textured volume: the Beer map is used',
      ),
    )
  return fits
}

/**
 * The context of one image of the volumes, none where there is nothing to encode: the state, the volumes placed, the camera's numbers (`frameView`),
 * the shadows' set-up, the holdout the volumes that hold out add to (cleared once before the first of them, where the alpha holdout is in effect and
 * the device lets the program bind its fifth storage texture) and, composited with the translucency, the two images of the camera's beer map.
 */
export function beginFrame(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  phase: 'shadows' | 'image',
): FrameContext | undefined {
  const { gpu } = rt
  const entered = heldStateOf(rt, phase)
  if (!entered) return undefined
  const { held, sparse, store } = entered
  const shadowed = phase === 'shadows'
  const settings: Settings = (field) => readHeterogeneousVolumeSetting(rt, field) as number
  if (shadowed) forgetShadows(rt, held)
  // The maps of the volumes' shadows are made where the setting asks them.
  // (The voxel grids are built whatever the volumes cast: a diagnostic view of their transmittance reads them.)
  if (shadowed && !settings('heterogeneousVolumesShadows') && !usesVoxelGrids(settings))
    return undefined
  releaseSwitchedOff(held, settings, rt.run.diagnostic)
  const clocks = rt.run.graphClocks ?? { time: 0, realTime: 0 }
  const placed = placedVolumes(
    { held, sparse, values: store.values, eye: cam.eye, clocks },
    settings,
  )
  if (!placed.length) return undefined
  const factor = settings('heterogeneousVolumesDownsampleFactor')
  const scaled = downsampledSize(gpu.targetSize, factor)
  const target = ensureTargets(held, device, scaled, factor)
  const beerFormat = beerFormatOf(settings('heterogeneousVolumesShadowsPrecision'))
  ensureStandIns(held, device, beerFormat)
  // The translucency volume of this image, where one is made (a view without lighting makes none): the indirect light is read from it.
  const gi = rt.views.active.overrides.lighting ? gpu.translucencyGi?.published : undefined
  const scalability = settings('heterogeneousVolumesScalability')
  writeFrameView(cam)
  const holdoutTarget = holdoutOf(rt, device, encoder, placed, shadowed)
  const cameraMaps = cameraMapsOf(held, device, scaled, beerFormat, settings, shadowed)
  return {
    rt,
    device,
    encoder,
    cam,
    held,
    sparse,
    shadowed,
    settings,
    target,
    scaled,
    factor,
    clocks,
    pre: preExposureOf(rt),
    gi,
    giView: gi?.fogView,
    scalability,
    ...scalabilityModes(settings, scalability, gi?.fogView),
    ...sceneInputs(rt, device, held, settings, scalability, shadowed),
    shadow: shadowSetup(
      held,
      device,
      rt,
      shadowed ? placed : undefined,
      settings,
      beerFormat,
      adaptiveFits(rt, device, placed, settings),
    ),
    placed,
    holdoutTarget,
    useExistence: !!settings('heterogeneousVolumesUseExistenceMask'),
    cameraMaps,
    beerFormat,
    first: true,
    ping: 0,
  }
}
