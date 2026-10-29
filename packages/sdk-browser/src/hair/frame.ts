import { readHairStrandsSetting } from '../../../sdk-core/src/contracts/hairStrandsOptions.ts'
import { readShadowSetting } from '../../../sdk-core/src/contracts/shadowOptions.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { cameraForward } from '../camera/forward.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { taaRenderProjection } from '../post/taa/frame.ts'
import type {
  HairFrameInputsWritable,
  HairSkyLightingSettings,
  HairVoxelSettings,
} from './inputs.ts'
import { HAIR_COMPONENT } from './hairBsdfWgsl.ts'
import { createHairLut, hairLutKey, type HairLutSettings } from './hairLutPass.ts'
import { deepShadowLights, type HairDeepShadowSettings } from './deepShadowMath.ts'
import { voxelPageResolution } from './voxelMath.ts'
import { HAIR_RASTER_DEFAULTS } from './rasterModes.ts'
import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import { createHairScene, encodeHairScene, planHairView, type HairScene } from './scene.ts'
import type { HairShadowInputs, HairShadowLight } from './shadowCasters.ts'
import { viewGpu } from '../frame/backend/state/view.ts'
import { frameLights } from '../lighting/shadows/vsm/frame/vsmPlan.ts'
import { vsmShadowed } from '../lighting/shadows/vsm/seenLights.ts'
import { hairFlagsOf } from './visibilityBlocks.ts'
import { createHairViewGpu, type HairViewGpu, type HairVisibilityView } from './viewGpu.ts'
import { armHairEnvironment } from './environment.ts'
import { encodeHairVisibility } from './visibility.ts'
import { armHairCullTrace } from './debugCull.ts'
import { disposeHairDebug } from './debugView.ts'

/**
 * THE HAIR STRANDS IN THE FRAME. While the strands are on (`hairStrands`) and the cache carries
 * some (`EngineContext.hairStrandsFile`), the first image asks the file and the image that finds it read
 * puts its groups on the GPU (`createHairScene`); each image after, after the surfaces are drawn and
 * before the shadows' pages are marked, encodes the strands' work for its view: the tangents of the
 * groups that have none, the visible instances gathered into macro groups (`encodeHairScene`), and
 * the bounds and voxel sizes of those, and then their visibility (`encodeHairVisibility`): the
 * transmittance, the tiles, the samples of a pixel and their compaction.
 *
 * What is the scene's — the file read, the groups, the instances and the tangents — is on the
 * runtime (`HairFrameState`). What depends on the camera is the view's (`HairViewGpu`, `gpu.hair`),
 * one for each view drawn, switched with it (`VIEW_GPU_KEYS`): a view drawn aside has strands of its
 * own, or none. The image's strands are what `encodeHairStrands` returns, valid for that image alone;
 * the passes of the frame that come after read them as `gpu.hair.visible`.
 * Switched off, the strands' buffers are given back.
 */
export interface HairFrameState {
  scene?: HairScene
  /** The read in flight or done, started once, and whether it failed (said once, never asked again). */
  reading?: Promise<void>
  failed: boolean
}

/** Asks the strands of the cache and puts them on `device` when read. A throw while they are put
 *  there is told as a failed read is. */
function startReading(rt: WebgpuPagesRuntime, state: HairFrameState, device: GPUDevice) {
  state.reading ??= rt.context.hairStrandsFile!()
    .then((strands) => {
      // Switched off or closed while the file was read: nothing to put on the GPU.
      if (rt.hair !== state || !strands.groups.length) return
      state.scene = createHairScene(device, strands)
      // A held image is drawn again to carry the strands.
      rt.run.gate.resourcesChanged()
    })
    .catch((error: unknown) => {
      state.failed = true
      rt.diag.diagnosticFailure('hair-strands-load-failed', error)
    })
}

/** The record of an image's inputs, for the camera `cam`; `fillInputs` writes its values. */
function createInputs(cam: EngineCamera): HairFrameInputsWritable {
  return {
    camera: cam,
    size: [0, 0],
    allocated: [0, 0],
    depthView: undefined,
    viewProjection: new Float64Array(16),
    inverseViewProjection: new Float64Array(16),
    forward: new Float64Array(3),
    pixelSize: [0, 0],
    sizeInPixel: 1,
    pageResolution: 1,
    samplesPerPixel: 1,
    meanSamplesPerPixel: 1,
    rasterizationScale: 1,
    stableRasterizationScale: 1,
    flags: 0,
    sortByDepth: false,
    hardwareRaster: true,
    fullCoverage: 1,
    // The surfaces are handed by each image that lights the strands (`fillInputs`).
    surfaces: undefined,
    emissionLayer: 0,
    shadow: undefined,
  }
}

/** The lights the frame shadows, refilled in place by each image (`shadowInputs`), and the record that
 *  names them. */
const castingLights: HairShadowLight[] = []
const shadowRecord: { lights: readonly HairShadowLight[]; distance: number } = {
  lights: castingLights,
  distance: 0,
}

/** The lights the frame shadows for the view of `cam` and the distance their grooms out of view are
 *  tested at; none while shadows are off or the grooms out of view do not cast. The lights are the
 *  shadow maps' own (`frameLights`, `vsmShadowed`): those that cast and that a point the view lights may
 *  be in reach of, a local light the view's draw range leaves out (`lightDrawn`) or its shadow gates
 *  take away keeping no groom. The record is refilled in place, valid for the image. */
function shadowInputs(rt: WebgpuPagesRuntime, cam: EngineCamera): HairShadowInputs | undefined {
  if (
    rt.lights.store.unlit ||
    !readHairStrandsSetting(rt, 'hairCastShadowWhenOutOfView') ||
    readShadowSetting(rt, 'shadowQuality') <= 0
  )
    return undefined
  castingLights.length = 0
  for (const entry of frameLights(rt, 'plan', cam))
    if (vsmShadowed(entry)) castingLights.push(entry.light)
  if (!castingLights.length) return undefined
  shadowRecord.distance = readHairStrandsSetting(rt, 'hairOutOfViewShadowDistance')
  return shadowRecord
}

/** The jitter modes of the voxels' rays by name: none, a new one each frame, one for good. */
const JITTER_MODES = { none: 0, randomized: 1, constant: 2 } as const

/** The deep shadows' settings, refilled in place by each image. */
const deepSettings: { -readonly [K in keyof HairDeepShadowSettings]: HairDeepShadowSettings[K] } = {
  resolution: 0,
  minResolution: 0,
  maxHalfFov: 0,
  aabbScale: 1,
  rasterizationScale: 1,
  kernelType: 0,
  kernelAperture: 0,
  densityScale: 0,
  depthBiasScale: 0,
}
const deepShadow = { settings: deepSettings, lights: [] as ReturnType<typeof deepShadowLights> }

/** The deep shadows of the frame for the view of `cam`: the lights that draw one and the settings; none
 *  where no light does or the voxels give the transmittance and the shadow alone. */
function deepShadowInputs(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  if (readHairStrandsSetting(rt, 'hairVoxelForceTransmittanceAndShadow')) return undefined
  deepShadow.lights = deepShadowLights(frameLights(rt, 'plan', cam), cam.eye)
  if (!deepShadow.lights.length) return undefined
  deepSettings.resolution = readHairStrandsSetting(rt, 'hairDeepShadowResolution')
  deepSettings.minResolution = readHairStrandsSetting(rt, 'hairDeepShadowMinResolution')
  deepSettings.maxHalfFov =
    (readHairStrandsSetting(rt, 'hairDeepShadowMaxFrustumAngle') * Math.PI) / 360
  deepSettings.aabbScale = readHairStrandsSetting(rt, 'hairDeepShadowAabbScale')
  const shadowScale = readHairStrandsSetting(rt, 'hairShadowRasterizationScale')
  deepSettings.rasterizationScale =
    shadowScale || readHairStrandsSetting(rt, 'hairRasterizationScale')
  deepSettings.kernelType = readHairStrandsSetting(rt, 'hairDeepShadowKernelType')
  deepSettings.kernelAperture = readHairStrandsSetting(rt, 'hairDeepShadowKernelAperture')
  deepSettings.densityScale = readHairStrandsSetting(rt, 'hairDeepShadowDensityScale')
  deepSettings.depthBiasScale = readHairStrandsSetting(rt, 'hairDeepShadowDepthBiasScale')
  return deepShadow
}

/** The filter and the jitter of the shadow the strands cast on the surfaces, refilled in place by each image. */
const surfaceShadow = { kernelType: 4, randomType: 2 }

/** The environment's integration, refilled in place by each image. */
const skySettings: { -readonly [K in keyof HairSkyLightingSettings]: HairSkyLightingSettings[K] } =
  {
    integration: 'sh',
    sampleCount: 1,
    distanceThreshold: 0,
    screenTrace: false,
  }

/** How the strands take the environment's light (`hairEnvironmentIntegration` and its settings, distances in metres). */
function skyLightingOf(rt: WebgpuPagesRuntime): HairSkyLightingSettings {
  skySettings.integration = readHairStrandsSetting(rt, 'hairEnvironmentIntegration')
  skySettings.sampleCount = readHairStrandsSetting(rt, 'hairSkyLightingSampleCount')
  skySettings.distanceThreshold =
    readHairStrandsSetting(rt, 'hairSkyLightingDistanceThreshold') * CENTIMETRE
  skySettings.screenTrace = readHairStrandsSetting(rt, 'hairSkyLightingScreenTraceOcclusion')
  return skySettings
}

/** The table's settings, refilled in place by each image. */
const lutSettings: { -readonly [K in keyof HairLutSettings]: HairLutSettings[K] } = {
  angles: 0,
  roughnesses: 0,
  absorptions: 0,
  sampleScale: 1,
}

/** The components of the fibre's BSDF the settings switch on. */
function componentsOf(rt: WebgpuPagesRuntime) {
  const on = (name: Parameters<typeof readHairStrandsSetting>[1], bit: number) =>
    readHairStrandsSetting(rt, name) ? bit : 0
  return (
    on('hairComponentR', HAIR_COMPONENT.r) |
    on('hairComponentTT', HAIR_COMPONENT.tt) |
    on('hairComponentTRT', HAIR_COMPONENT.trt) |
    on('hairComponentLocalScattering', HAIR_COMPONENT.localScattering) |
    on('hairComponentGlobalScattering', HAIR_COMPONENT.globalScattering) |
    on('hairComponentTTModel', HAIR_COMPONENT.ttModel)
  )
}

/** The centimetres of the settings, in metres. */
const CENTIMETRE = 0.01

/** The voxel volume's settings, refilled in place by each image. */
const voxel: { -readonly [K in keyof HairVoxelSettings]: HairVoxelSettings[K] } = {
  worldSize: 0,
  pageResolution: 2,
  pageCountPerDim: 1,
  aabbScale: 1,
  adaptive: false,
  gpuDriven: true,
  invalidateEmptyPageIndex: true,
  densityScaleTransmittance: 0,
  depthBiasScaleTransmittance: 0,
  steppingScaleTransmittance: 1,
  jitterMode: 1,
  superSampling: false,
  mipTraversal: true,
  densityScaleAO: 0,
  steppingScaleEnvironment: 1,
  depthBiasScaleEnvironment: 0,
  densityScaleEnvironment: 0,
  densityScaleShadow: 0,
  depthBiasScaleShadow: 0,
  steppingScaleShadow: 1,
  correctionSpeed: 0,
  correctionThreshold: 0,
  minPageIndexResolution: 1,
  maxPageIndexResolution: 1,
  injectOpaqueDepth: false,
  biasCount: 0,
  markCount: 0,
}

type HairSettingKey = Parameters<typeof readHairStrandsSetting>[1]

/** A density scale of the volume: the setting `key`, or the global one (`hairVoxelDensityScale`) where it is negative. */
const voxelDensityScale = (rt: WebgpuPagesRuntime, key: HairSettingKey) => {
  const own = readHairStrandsSetting(rt, key) as number
  return Math.max(
    0,
    own >= 0 ? own : (readHairStrandsSetting(rt, 'hairVoxelDensityScale') as number),
  )
}

/** A stepping scale of the volume: the setting `key`, or the global one (`hairVoxelSteppingScale`) where it is negative, held to 1..10. */
const voxelSteppingScale = (rt: WebgpuPagesRuntime, key: HairSettingKey) => {
  const own = readHairStrandsSetting(rt, key) as number
  return Math.min(
    10,
    Math.max(1, own >= 0 ? own : (readHairStrandsSetting(rt, 'hairVoxelSteppingScale') as number)),
  )
}

/** The voxel volume's settings of the frame (`hairVoxel*`), lengths in metres. */
function voxelSettings(rt: WebgpuPagesRuntime): HairVoxelSettings {
  voxel.worldSize = readHairStrandsSetting(rt, 'hairVoxelWorldSize') * CENTIMETRE
  voxel.pageResolution = voxelPageResolution(readHairStrandsSetting(rt, 'hairVoxelPageResolution'))
  voxel.pageCountPerDim = readHairStrandsSetting(rt, 'hairVoxelPageCountPerDim')
  voxel.aabbScale = readHairStrandsSetting(rt, 'hairVoxelizationAabbScale')
  voxel.adaptive = readHairStrandsSetting(rt, 'hairVoxelAdaptive')
  voxel.densityScaleTransmittance = voxelDensityScale(rt, 'hairVoxelDensityScaleTransmittance')
  voxel.depthBiasScaleTransmittance = readHairStrandsSetting(
    rt,
    'hairVoxelDepthBiasScaleTransmittance',
  )
  voxel.steppingScaleTransmittance = voxelSteppingScale(rt, 'hairVoxelSteppingScaleTransmittance')
  voxel.densityScaleAO = voxelDensityScale(rt, 'hairVoxelDensityScaleAO')
  voxel.densityScaleShadow = voxelDensityScale(rt, 'hairVoxelDensityScaleShadow')
  voxel.depthBiasScaleShadow = readHairStrandsSetting(rt, 'hairVoxelDepthBiasScaleShadow')
  voxel.steppingScaleShadow = voxelSteppingScale(rt, 'hairVoxelSteppingScaleShadow')
  voxel.densityScaleEnvironment = voxelDensityScale(rt, 'hairVoxelDensityScaleEnvironment')
  voxel.steppingScaleEnvironment = voxelSteppingScale(rt, 'hairVoxelSteppingScaleEnvironment')
  voxel.depthBiasScaleEnvironment = readHairStrandsSetting(rt, 'hairVoxelDepthBiasScaleEnvironment')
  voxel.jitterMode = JITTER_MODES[readHairStrandsSetting(rt, 'hairVoxelJitter')]
  voxel.superSampling = readHairStrandsSetting(rt, 'hairTransmittanceSuperSampling')
  voxel.mipTraversal = readHairStrandsSetting(rt, 'hairTransmittanceMipTraversal')
  voxel.gpuDriven = readHairStrandsSetting(rt, 'hairVoxelGpuDriven')
  voxel.invalidateEmptyPageIndex = readHairStrandsSetting(rt, 'hairVoxelInvalidateEmptyPageIndex')
  voxel.correctionSpeed = readHairStrandsSetting(rt, 'hairVoxelAdaptiveCorrectionSpeed')
  voxel.correctionThreshold = readHairStrandsSetting(rt, 'hairVoxelAdaptiveCorrectionThreshold')
  voxel.minPageIndexResolution = readHairStrandsSetting(
    rt,
    'hairVoxelGpuDrivenMinPageIndexResolution',
  )
  voxel.maxPageIndexResolution = readHairStrandsSetting(
    rt,
    'hairVoxelGpuDrivenMaxPageIndexResolution',
  )
  voxel.injectOpaqueDepth = readHairStrandsSetting(rt, 'hairVoxelInjectOpaqueDepth')
  voxel.biasCount = readHairStrandsSetting(rt, 'hairVoxelInjectOpaqueBiasCount')
  voxel.markCount = readHairStrandsSetting(rt, 'hairVoxelInjectOpaqueMarkCount')
  return voxel
}

const projection = new Float64Array(16)

/** The curve raster's settings, refilled in place by each image that runs it. */
const renderCurve = { binners: 0, rasterizers: 0, minCoverage: 0 }

/** Refills `inputs` with what the frame holds for the image of `cam`: the one place the passes'
 *  inputs are read from the runtime. */
function fillInputs(rt: WebgpuPagesRuntime, cam: EngineCamera, inputs: HairFrameInputsWritable) {
  const { gpu } = rt
  inputs.camera = cam
  inputs.size = gpu.targetSize
  inputs.allocated = gpu.allocatedSize
  inputs.depthView = gpu.depthView
  taaRenderProjection(rt, cam, projection)
  multiplyMatrix4(inputs.viewProjection as Float64Array, projection, cam.viewRelative)
  invertMatrix4(inputs.inverseViewProjection as Float64Array, inputs.viewProjection)
  cameraForward(inputs.forward as Float64Array, cam.world)
  inputs.pixelSize = readHairStrandsSetting(rt, 'hairVisibilityResolutionScaleAware')
    ? gpu.targetSize
    : gpu.displaySize
  inputs.sizeInPixel = readHairStrandsSetting(rt, 'hairVoxelSizeInPixel')
  inputs.pageResolution = readHairStrandsSetting(rt, 'hairVoxelPageResolution')
  inputs.samplesPerPixel = readHairStrandsSetting(rt, 'hairVisibilitySamplesPerPixel')
  inputs.meanSamplesPerPixel = readHairStrandsSetting(rt, 'hairVisibilityMeanSamplesPerPixel')
  inputs.rasterizationScale = readHairStrandsSetting(rt, 'hairRasterizationScale')
  inputs.stableRasterizationScale = readHairStrandsSetting(rt, 'hairStableRasterizationScale')
  const scatterScene = readHairStrandsSetting(rt, 'hairScatterSceneLighting')
  inputs.scatterSceneLighting = scatterScene
  inputs.sky = skyLightingOf(rt)
  inputs.surfaceShadow = surfaceShadow
  surfaceShadow.kernelType = readHairStrandsSetting(rt, 'hairDeepShadowMaskKernelType')
  surfaceShadow.randomType = readHairStrandsSetting(rt, 'hairDeepShadowRandomType')
  inputs.flags = hairFlagsOf(
    scatterScene,
    readHairStrandsSetting(rt, 'hairStableRasterization'),
    readHairStrandsSetting(rt, 'hairCastContactShadow'),
    readHairStrandsSetting(rt, 'hairRenderCustomDepth'),
  )
  inputs.sortByDepth = readHairStrandsSetting(rt, 'hairVisibilitySortByDepth')
  inputs.hardwareRaster = !readHairStrandsSetting(rt, 'hairVisibilityComputeRaster')
  inputs.forwardRaster = readHairStrandsSetting(rt, 'hairVisibilityComputeRasterForward')
  inputs.coverageMapping = readHairStrandsSetting(rt, 'hairVisibilityCoverageMapping')
  const raster = (inputs.raster ??= { ...HAIR_RASTER_DEFAULTS })
  raster.naive = readHairStrandsSetting(rt, 'hairVisibilityNaiveRaster')
  raster.tileCompaction = readHairStrandsSetting(rt, 'hairVisibilityTileCompaction')
  raster.classification = readHairStrandsSetting(rt, 'hairVisibilityClassification')
  raster.tileSize = readHairStrandsSetting(rt, 'hairVisibilityComputeRasterTileSize')
  raster.maxTiles = readHairStrandsSetting(rt, 'hairVisibilityComputeRasterMaxTiles')
  raster.numClassifiers = readHairStrandsSetting(rt, 'hairVisibilityNumClassifiers')
  raster.numBinners = readHairStrandsSetting(rt, 'hairVisibilityComputeRasterNumBinners')
  raster.numRasterizers = readHairStrandsSetting(rt, 'hairVisibilityComputeRasterNumRasterizers')
  raster.numRasterizersNaive = readHairStrandsSetting(
    rt,
    'hairVisibilityComputeRasterNumRasterizersNaive',
  )
  if (
    readHairStrandsSetting(rt, 'renderCurve') &&
    readHairStrandsSetting(rt, 'renderCurveSwRaster')
  ) {
    renderCurve.binners = readHairStrandsSetting(rt, 'renderCurveRasterNumBinners')
    renderCurve.rasterizers = readHairStrandsSetting(rt, 'renderCurveRasterNumRasterizers')
    renderCurve.minCoverage = readHairStrandsSetting(rt, 'renderCurveRasterMinCoverage')
    inputs.renderCurve = renderCurve
  } else inputs.renderCurve = undefined
  inputs.customDepthCoverage = readHairStrandsSetting(rt, 'hairRenderCustomDepth')
    ? readHairStrandsSetting(rt, 'hairCustomDepthCoverageThreshold')
    : undefined
  inputs.fullCoverage = readHairStrandsSetting(rt, 'hairVisibilityFullCoverageThreshold')
  // The strands are lit over the surfaces they cover (`encodeHairLighting`): those wholly under them are emptied.
  const surfaces = rt.lights.store.unlit ? undefined : gpu.surfaces
  inputs.surfaces = surfaces?.stores()
  inputs.emissionLayer = surfaces ? surfaces.layers & 0xff : 0
  inputs.shadow = shadowInputs(rt, cam)
  inputs.voxel = readHairStrandsSetting(rt, 'hairVoxelization') ? voxelSettings(rt) : undefined
  inputs.deepShadow = deepShadowInputs(rt, cam)
  lutSettings.angles = readHairStrandsSetting(rt, 'hairLutIncidentAngleCount')
  lutSettings.roughnesses = readHairStrandsSetting(rt, 'hairLutRoughnessCount')
  lutSettings.absorptions = readHairStrandsSetting(rt, 'hairLutAbsorptionCount')
  lutSettings.sampleScale = readHairStrandsSetting(rt, 'hairLutSampleCountScale')
  inputs.lut = lutSettings
  inputs.components = componentsOf(rt)
}

/** Encodes the strands' work for this image on `encoder`, in the frame's order: after the base pass,
 *  before the shadows' pages are marked. Returns the strands of the image, none when it has none to
 *  show. */
export function encodeHairStrands(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
): HairVisibilityView | undefined {
  rt.bounce.stage = undefined
  if (!rt.context.hairStrandsFile || !readHairStrandsSetting(rt, 'hairStrands')) {
    disposeHairStrands(rt)
    return undefined
  }
  const state = (rt.hair ??= { failed: false })
  if (state.failed) return undefined
  if (!state.scene) {
    startReading(rt, state, device)
    return undefined
  }
  let view: HairViewGpu | undefined = rt.gpu.hair
  if (view?.scene !== state.scene) {
    view?.dispose()
    view = rt.gpu.hair = createHairViewGpu(device, state.scene, createInputs(cam))
  }
  fillInputs(rt, cam, view.inputs)
  ensureHairLut(device, encoder, view)
  const { instances } = state.scene
  armHairCullTrace(
    view.lists.plan.trace,
    readHairStrandsSetting(rt, 'hairCastShadowWhenOutOfViewDebug'),
  )
  const macroGroups = planHairView(instances, view.bounds.update, view.lists, view.inputs)
  encodeHairScene(device, encoder, state.scene, view.bounds)
  const visible = encodeHairVisibility(device, encoder, view, macroGroups, (error) =>
    rt.diag.diagnosticFailure('hair-strands-visibility-failed', error),
  )
  // The screen probes' pass lights the strands from the radiance cache when it casts (`armHairEnvironment`).
  armHairEnvironment(rt, device, view)
  return visible
}

/** The table of the fibre's scattering the strands are lit with, made once for the settings that decide it and
 *  made again when they change: the view's, given back with it. None until the strands are lit. */
function ensureHairLut(device: GPUDevice, encoder: GPUCommandEncoder, view: HairViewGpu) {
  const { inputs } = view
  if (!inputs.surfaces || !inputs.lut) return
  const key = `scattering ${hairLutKey(inputs.lut)}`
  if (view.lut?.key !== key) {
    const made = createHairLut(device, encoder, inputs.lut)
    if (made) {
      view.lut?.dispose()
      view.lut = made
    }
  }
}

/** Gives the strands' buffers of a view back. */
export function disposeHairView(gpu: Pick<WebgpuPagesRuntime['gpu'], 'hair'>) {
  gpu.hair?.dispose()
  gpu.hair = undefined
}

/** Gives the strands' buffers back: the scene's, and those of every view's slot, the drawn view's, the
 *  main view's and the persistent views'. */
export function disposeHairStrands(rt: Pick<WebgpuPagesRuntime, 'hair' | 'gpu' | 'views'>) {
  const { views } = rt
  for (const view of [views.main, ...views.persistent]) disposeHairView(viewGpu(rt, view))
  disposeHairView(rt.gpu)
  disposeHairDebug(rt)
  rt.hair?.scene?.dispose()
  rt.hair = undefined
}
