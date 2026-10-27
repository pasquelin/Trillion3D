import { readHairStrandsSetting } from '../../../sdk-core/src/contracts/hairStrandsOptions.ts'
import { readShadowSetting } from '../../../sdk-core/src/contracts/shadowOptions.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { cameraForward } from '../camera/forward.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { taaRenderProjection } from '../post/taa/frame.ts'
import type { HairFrameInputsWritable } from './inputs.ts'
import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import { createHairScene, encodeHairScene, planHairView, type HairScene } from './scene.ts'
import type { HairShadowInputs, HairShadowLight } from './shadowCasters.ts'
import { viewGpu } from '../frame/backend/state/view.ts'
import { frameLights } from '../lighting/shadows/vsm/frame/vsmPlan.ts'
import { vsmShadowed } from '../lighting/shadows/vsm/seenLights.ts'
import { hairFlagsOf } from './visibilityBlocks.ts'
import { createHairViewGpu, type HairViewGpu, type HairVisibilityView } from './viewGpu.ts'
import { encodeHairVisibility } from './visibility.ts'

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
    fullCoverage: 1,
    // The surfaces are not handed: nothing lights the strands yet, so the surfaces they cover keep
    // their own (the lighting of the strands hands them, `encodeHairVisibility`).
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

const projection = new Float64Array(16)

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
  inputs.flags = hairFlagsOf(
    readHairStrandsSetting(rt, 'hairScatterSceneLighting'),
    readHairStrandsSetting(rt, 'hairStableRasterization'),
    readHairStrandsSetting(rt, 'hairCastContactShadow'),
  )
  inputs.sortByDepth = readHairStrandsSetting(rt, 'hairVisibilitySortByDepth')
  inputs.fullCoverage = readHairStrandsSetting(rt, 'hairVisibilityFullCoverageThreshold')
  inputs.shadow = shadowInputs(rt, cam)
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
  const { instances } = state.scene
  const macroGroups = planHairView(instances, view.bounds.update, view.lists, view.inputs)
  encodeHairScene(device, encoder, state.scene, view.bounds)
  return encodeHairVisibility(device, encoder, view, macroGroups, (error) =>
    rt.diag.diagnosticFailure('hair-strands-visibility-failed', error),
  )
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
  rt.hair?.scene?.dispose()
  rt.hair = undefined
}
