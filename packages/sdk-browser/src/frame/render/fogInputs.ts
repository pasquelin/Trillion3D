import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { ResolvedVolumetricFog } from '../../../../sdk-core/src/scene/core/fogVolumetric.ts'
import { cameraForward } from '../../camera/forward.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { FogVolumeInputs, Scratch } from '../../lighting/fog/gpu.ts'
import { opaquePyramidOf } from '../../lighting/reflections/frame.ts'
import { vsmOrStandIns } from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { viewProj } from '../backend/helpers.ts'
import { directLightResources } from '../prepare/contractLight.ts'

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
  allocated: [0, 0],
  depth: undefined,
  hiz: undefined,
  lights: undefined,
  tiles: undefined,
  cubemap: undefined,
  cut: false,
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

/**
 * The image's camera and lights written into the volume's inputs: the unjittered matrices and the
 * render matrix the depth was drawn with, the light buffer and its lists, the sun's rank, and the
 * virtual shadow maps the sun's shadow reads — the very ones a blended surface binds
 * (`directLightResources`), or their stand-ins. `direct` is what the light lists encoded
 * (`encodeDirectLights`), whose columns and rows the volume's lights are read from; `cut` whether
 * the camera cut the history. Returns the inputs whole: they stay valid until `clearFogInputs`.
 */
export function fogInputsOf(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  direct: ArrayLike<number>,
  buffer: GPUBuffer,
  fog: { medium: ResolvedVolumetricFog; settings: VolumetricFogValues; cubemap?: GPUTextureView },
  cut: boolean,
): FogVolumeInputs {
  const { gpu, lights } = rt
  const { placeholders } = gpu.deferred!
  const contract = directLightResources(rt)
  const { camera } = inputs
  invertMatrix4(inverse, cam.viewProjection)
  cameraForward(forward, cam.world)
  camera!.eye = cam.eye
  camera!.projection = cam.projection
  camera!.viewProj = cam.viewProjection
  camera!.near = cam.near
  camera!.width = gpu.targetSize[0]
  camera!.height = gpu.targetSize[1]
  camera!.perspective = cam.perspective === 1
  inputs.allocated = gpu.allocatedSize
  inputs.depth = gpu.depthView
  inputs.hiz = opaquePyramidOf(rt)
  inputs.lights = buffer
  inputs.tiles = contract.tiles ?? placeholders.tiles
  const vsm = vsmOrStandIns(contract.vsm, placeholders)
  vsmInputs.pageTable = vsm.pageTable
  vsmInputs.projectionData = vsm.projectionData
  vsmInputs.uniforms = vsm.uniforms
  vsmInputs.pool = vsm.pool
  vsmInputs.view = vsm.view
  inputs.vsm = vsmInputs as FogVolumeInputs['vsm']
  inputs.sunRank = lights.store.fogSunSlot
  lightCells[0] = direct[1]
  lightCells[1] = direct[2]
  inputs.frameIndex = rt.run.frame
  inputs.medium = fog.medium
  inputs.settings = fog.settings
  inputs.cubemap = fog.cubemap
  inputs.cut = cut
  return inputs as FogVolumeInputs
}

/** The inputs let go: the scratch object holds no GPU object past the image. */
export function clearFogInputs() {
  inputs.depth =
    inputs.lights =
    inputs.tiles =
    inputs.medium =
    inputs.hiz =
    inputs.cubemap =
      undefined
  inputs.vsm = undefined
  vsmInputs.pageTable = vsmInputs.projectionData = vsmInputs.uniforms = undefined
  vsmInputs.pool = vsmInputs.view = undefined
}
