import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { ResolvedVolumetricFog } from '../../../../sdk-core/src/scene/core/fogVolumetric.ts'
import { cameraForward } from '../../camera/forward.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { cloudShadowStandIn } from '../../lighting/atmosphere/cloudShadowStandIn.ts'
import type { FogVolumeInputs, Scratch } from '../../lighting/fog/gpu.ts'
import { fillFogStaticLight } from '../../lighting/fog/staticFrame.ts'
import { newFogStaticLight } from '../../lighting/fog/staticLight.ts'
import { lightFunctionResources } from '../../lighting/lightFunction/frame.ts'
import { opaquePyramidOf } from '../../lighting/reflections/frame.ts'
import { vsmOrStandIns } from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import { sampledVolumeFog } from '../../lighting/manyLightsSampled/volumeFrame.ts'
import { noiseFrame } from './noiseFrame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { viewProj } from '../backend/helpers.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { directLightResources } from '../prepare/contractLight.ts'
import { cloudShadowOf } from './encodeCloudShadow.ts'
import { skyLightReadOf } from './skyLightState.ts'
import { fogSkyField } from './encodeSkyOcclusion.ts'
import { fogGraphMaps } from './fogGraphMaps.ts'
import { fogReadOf } from './localFogGpu.ts'

/** The matrices and vectors of the image's camera the volume reads: the inverse view-projection and
 *  the forward are written here, the rest are the engine camera's own. */
const inverse = new Float64Array(16)
const forward = new Float64Array(3)
const lightCells: [number, number] = [0, 0]
/** What stands in a camera field before the first image writes it. */
const NO_MATRIX = new Float64Array(16)
const NO_VECTOR = new Float64Array(3)

/** What the image tells the volume's passes, rewritten each image — nothing is allocated — and let
 *  go when the image is encoded (`clearFogInputs`): no GPU object is held past it. */
const inputs: Scratch<FogVolumeInputs> = {
  camera: {
    eye: NO_VECTOR,
    forward,
    world: NO_MATRIX,
    projection: NO_MATRIX,
    viewProj: NO_MATRIX,
    inverseViewProj: inverse,
    depthViewProj: viewProj,
    near: 0,
    width: 0,
    height: 0,
    perspective: true,
  },
  medium: undefined,
  settings: undefined,
  sunRank: -1,
  lightCells,
  frameIndex: 0,
  preExposure: 1,
  exposure: 1,
  allocated: [0, 0],
  depth: undefined,
  hiz: undefined,
  field: undefined,
  volumes: undefined,
  graphMaps: undefined,
  graphClocks: undefined,
  lights: undefined,
  tiles: undefined,
  localTiles: undefined,
  cubemap: undefined,
  lightFunction: undefined,
  cloudShadow: undefined,
  sky: undefined,
  translucencyGi: undefined,
  staticLight: newFogStaticLight(),
  lightmap: undefined,
  cut: false,
  mlVolume: undefined,
  vsm: undefined,
}
/** The virtual shadow maps' slot of the inputs: its own object, whose fields are let go too. */
const vsmInputs: Scratch<NonNullable<FogVolumeInputs['vsm']>> = {
  pageTable: undefined,
  projectionData: undefined,
  uniforms: undefined,
  pool: undefined,
  view: undefined,
}

/** The image's camera written into the volume's inputs: the inverse view-projection and the forward are computed here. */
function writeCamera(cam: EngineCamera, size: ArrayLike<number>) {
  const camera = inputs.camera!
  invertMatrix4(inverse, cam.viewProjection)
  cameraForward(forward, cam.world)
  camera.eye = cam.eye
  camera.world = cam.world
  camera.projection = cam.projection
  camera.viewProj = cam.viewProjection
  camera.near = cam.near
  camera.width = size[0]
  camera.height = size[1]
  camera.perspective = cam.perspective === 1
  return camera
}

/** The virtual shadow maps the sun's shadow reads (or their stand-ins) written into their slot of the inputs. */
function writeVsm(vsm: ReturnType<typeof vsmOrStandIns>) {
  vsmInputs.pageTable = vsm.pageTable
  vsmInputs.projectionData = vsm.projectionData
  vsmInputs.uniforms = vsm.uniforms
  vsmInputs.pool = vsm.pool
  vsmInputs.view = vsm.view
  return vsmInputs as FogVolumeInputs['vsm']
}

/**
 * The image's camera and lights written into the volume's inputs: the unjittered matrices and the
 * render matrix the depth was drawn with, the light buffer and its lists, the sun's rank, and the
 * virtual shadow maps the sun's shadow reads — the very ones a blended surface binds
 * (`directLightResources`), or their stand-ins. `direct` is what the light lists encoded
 * (`encodeDirectLights`), whose columns and rows the volume's lights are read from; `cut` whether
 * the camera cut the history; the light functions' atlas, the clouds' shade and the sky light are the
 * ones the image holds or their stand-ins, the baked light (`fillFogStaticLight`) the one the medium and
 * the view's switches let it read, the translucency volume the one the image made earlier (`encodeTranslucencyGi`), if any. Returns the inputs whole: they stay valid until `clearFogInputs`.
 */
export function fogInputsOf(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  direct: ArrayLike<number>,
  device: GPUDevice,
  buffer: GPUBuffer,
  fog: { medium: ResolvedVolumetricFog; settings: VolumetricFogValues; cubemap?: GPUTextureView },
  cut: boolean,
): FogVolumeInputs {
  const { gpu, lights } = rt
  const { placeholders } = gpu.deferred!
  const contract = directLightResources(rt)
  const camera = writeCamera(cam, gpu.targetSize)
  inputs.allocated = gpu.allocatedSize
  inputs.depth = gpu.depthView
  inputs.hiz = opaquePyramidOf(rt)
  // The translucency volume of this image, where one is made (a view without lighting makes none): its light is the sky light's
  // place in the cells, and the sky's visibility in the distance field has no use then.
  const gi = rt.views.active.overrides.lighting ? gpu.translucencyGi?.published : undefined
  inputs.translucencyGi = gi?.fogView
    ? (gi as NonNullable<FogVolumeInputs['translucencyGi']>)
    : undefined
  inputs.field = gi?.fogView ? undefined : fogSkyField(rt, camera.perspective)
  inputs.volumes = rt.context.sceneVolumes
  inputs.graphMaps = rt.context.sceneVolumes?.count ? fogGraphMaps(rt) : undefined
  inputs.graphClocks = rt.run.graphClocks
  inputs.lights = buffer
  inputs.tiles = contract.tiles ?? placeholders.tiles
  inputs.localTiles = (fogReadOf(rt) ?? placeholders.fog).tiles
  inputs.vsm = writeVsm(vsmOrStandIns(contract.vsm, placeholders))
  inputs.sunRank = lights.store.forwardDirectionalSlot
  lightCells[0] = direct[1]
  lightCells[1] = direct[2]
  inputs.frameIndex = noiseFrame(rt)
  inputs.medium = fog.medium
  inputs.settings = fog.settings
  inputs.cubemap = fog.cubemap
  const pre = preExposureOf(rt)
  inputs.preExposure = pre.now
  inputs.exposure = pre.exposure
  inputs.lightFunction =
    lightFunctionResources(rt, 'lightFunctionFog') ?? placeholders.lightFunction
  inputs.cloudShadow = cloudShadowOf(rt) ?? cloudShadowStandIn(device)
  inputs.sky = skyLightReadOf(rt)
  fillFogStaticLight(inputs as FogVolumeInputs, rt, device, fog.medium)
  inputs.cut = cut
  inputs.mlVolume = sampledVolumeFog(rt)
  return inputs as FogVolumeInputs
}

/** The inputs let go: the scratch object holds no GPU object past the image. */
export function clearFogInputs() {
  inputs.depth =
    inputs.lights =
    inputs.tiles =
    inputs.localTiles =
    inputs.medium =
    inputs.hiz =
    inputs.mlVolume =
    inputs.cubemap =
    inputs.field =
    inputs.lightFunction =
    inputs.cloudShadow =
    inputs.sky =
    inputs.lightmap =
    inputs.translucencyGi =
      undefined
  inputs.vsm = undefined
  vsmInputs.pageTable = vsmInputs.projectionData = vsmInputs.uniforms = undefined
  vsmInputs.pool = vsmInputs.view = undefined
}
