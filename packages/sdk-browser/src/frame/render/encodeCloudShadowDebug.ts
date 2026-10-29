import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { createTextOverlay } from '../../diagnostic/textOverlay.ts'
import { DEBUG_COLORS } from '../../hair/debugLines.ts'
import type { CloudSkyMapFrame } from '../../lighting/atmosphere/cloudShadowRead.ts'
import { createGpuLines, type GpuLines } from '../../lighting/surfaceCache/sceneDebug/gpuLines.ts'
import {
  CLOUD_SHADOW_DEBUG_GROUP,
  CLOUD_SHADOW_DEBUG_WGSL,
} from '../../modules/sky/clouds/shadowDebugWgsl.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { cloudShadowOf, cloudShadowSourceOf } from './encodeCloudShadow.ts'

/**
 * THE CLOUD MAPS OVER THE IMAGE (`cloudShadowMapDebug`, `cloudSkyAODebug`): the first light's shadow map and the sky occlusion map each drawn as their frustum (orange, blue) and, for every
 * texel that holds cloud, its quad (`modules/sky/clouds/shadowDebugWgsl.ts`); the shadow map's sample count is written at two fifths of the image's height.
 */

/** Where the sample count is written, as a share of the image's height, and its colour. */
const TEXT_AT = 0.4
const TEXT_COLOR = DEBUG_COLORS.orange
const kernel = autoKernel('Trillion3D cloud map debug', CLOUD_SHADOW_DEBUG_WGSL, 'cloudShadowDebug')

interface DebugState {
  readonly text: ReturnType<typeof createTextOverlay>
  readonly lines: GpuLines
}

const states = new WeakMap<WebgpuPagesRuntime, DebugState>()
/** The uniform of a map: its matrix back, the rays' direction, the camera's place from the eye. */
const words = new Float32Array(24)
const scratch = new Float64Array(16)

/** Gives the lines of a runtime back. */
export function disposeCloudShadowDebug(rt: WebgpuPagesRuntime) {
  const state = states.get(rt)
  state?.text.dispose()
  state?.lines.dispose()
  states.delete(rt)
}

/** The matrix from clip space to the world, scene metres, of a map whose own goes to centimetres from `camera`: scaled to metres, then moved to the camera. */
export function worldFromClip(back: ArrayLike<number>, camera: ArrayLike<number>) {
  const out = scratch
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 3; row++)
      out[column * 4 + row] =
        back[column * 4 + row]! / CENTIMETRES_PER_METRE + camera[row]! * back[column * 4 + 3]!
  for (let column = 0; column < 4; column++) out[column * 4 + 3] = back[column * 4 + 3]!
  return out
}

/** Appends the quads of the map `map` (read from `view`) and writes its frustum in `color`. */
function appendMap(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: DebugState,
  name: string,
  map: CloudSkyMapFrame,
  view: GPUTextureView,
  camera: ArrayLike<number>,
  cam: EngineCamera,
  color: number,
) {
  state.text.lines.frustumFrom(worldFromClip(map.cameraFromClip, camera), 0, 1, color)
  words.set(map.cameraFromClip, 0)
  words.set(map.rayDirection, 16)
  words.set([camera[0]! - cam.eye[0]!, camera[1]! - cam.eye[1]!, camera[2]! - cam.eye[2]!], 20)
  const groups = ceilDiv(map.side, CLOUD_SHADOW_DEBUG_GROUP)
  state.lines.run(
    encoder,
    kernel(device),
    [
      { buffer: state.lines.uniform(name, words.buffer) },
      view,
      { buffer: state.lines.lines },
      { buffer: state.lines.count },
    ],
    groups,
    groups,
  )
}

/** After the image's maps: the maps asked for drawn over the display, the lines of the other views left as they are. */
export function encodeCloudShadowDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const quality = cloudShadowSourceOf(rt)?.part.quality
  const set = cloudShadowOf(rt)
  const shadow = quality?.cloudShadowMapDebug ? set?.frames?.[0] : undefined
  const sky = quality?.cloudSkyAODebug ? set?.skyFrame : undefined
  if (!shadow && !sky) return disposeCloudShadowDebug(rt)
  if (!set || !gpu.displayView) return
  let state = states.get(rt)
  if (!state)
    states.set(rt, (state = { text: createTextOverlay(device), lines: createGpuLines(device) }))
  const camera = set.camera ?? cam.eye
  state.text.begin(cam)
  state.lines.begin(encoder)
  if (shadow) {
    const [, height] = gpu.displaySize
    state.text.lines.text(
      `Shadow Sample Count = ${shadow.samples.toFixed(1)}`,
      0,
      height * TEXT_AT,
      TEXT_COLOR,
    )
    appendMap(
      device,
      encoder,
      state,
      'shadow',
      shadow,
      set.maps[0],
      camera,
      cam,
      DEBUG_COLORS.orange,
    )
  }
  if (sky) appendMap(device, encoder, state, 'sky', sky, set.ao, camera, cam, DEBUG_COLORS.blue)
  state.lines.end(encoder)
  state.text.encode(encoder, gpu.displayView, gpu.displaySize, cam, state.lines.appended)
}
