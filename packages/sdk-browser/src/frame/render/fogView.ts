import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { ResolvedHeightFog } from '../../../../sdk-core/src/scene/core/fogHeight.ts'
import { writeFogViewBlock, type FogViewLook } from '../../lighting/fog/viewBlock.ts'
import { FOG_VIEW_FLOATS, FOG_VIEW_SLOT } from '../../lighting/fog/viewSlots.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { LIGHT_BUFFER_AT } from '../backend/state/lightBufferLayout.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { SkyLightFog } from './skyLightFog.ts'
import { writeViewClipPlaneAtEye } from './viewClip.ts'
import { fogHoldout } from '../prepare/alphaHoldout.ts'

/** The view block this image writes, and what it takes of the camera and the fog, rewritten in place. */
const viewBlock = new Float32Array(FOG_VIEW_FLOATS)
const look = { perspective: true, eyeHeight: 0 } as FogViewLook

/** The view block last written into each light buffer: an image whose block is the same writes
 *  nothing, and a buffer not in it holds zeros, as it was made. */
const published = new WeakMap<GPUBuffer, Float32Array>()

/** Whether the view drawn now does not show the height fog `fog`: a view of the page by its
 *  `inMainView`, a capture of the scene that lights it (`ViewOverrides.reflectionCapture`) by its
 *  `inReflectionCaptures`. */
export const fogHiddenIn = (rt: Pick<WebgpuPagesRuntime, 'views'>, fog: ResolvedHeightFog) =>
  !(rt.views.active.overrides.reflectionCapture ? fog.inReflectionCaptures : fog.inMainView)

/** The view block written into the light buffer (`LIGHT_BUFFER_AT.fogView`), where the programs
 *  that read the fog find the image's cells — from the frame the volume was built with, or zero
 *  where none was built (`writeFogViewBlock`) — and the plane the view clips at, which the fog
 *  starts from (`FOG_VIEW_SLOT.clipPlane`, zero for a view without one), its offset taken to the eye
 *  in double precision, as the shader reads it. It tells whether the view shows the height fog
 *  (`fogHiddenIn`) and the sky light that lights it (`skyLight`, `skyLightFogOf`). Written once it
 *  differs from what the buffer holds. */
export function publishFogView(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  buffer: GPUBuffer,
  cam: EngineCamera,
  frame: Float32Array | undefined,
  settings: VolumetricFogValues,
  fog: FogViewLook['fog'],
  skyLight?: SkyLightFog,
) {
  look.perspective = cam.perspective === 1
  look.eyeHeight = cam.eye[1]
  look.fog = fog
  look.hidden = !!fog && fogHiddenIn(rt, fog)
  look.holdout = fogHoldout(rt, fog)
  look.skyLight = skyLight
  writeFogViewBlock(viewBlock, frame, settings, look)
  writeViewClipPlaneAtEye(rt, cam, viewBlock, FOG_VIEW_SLOT.clipPlane * 4)
  const last = published.get(buffer) ?? new Float32Array(FOG_VIEW_FLOATS)
  let same = true
  for (let i = 0; same && i < FOG_VIEW_FLOATS; i++) same = last[i] === viewBlock[i]
  if (same) return
  device.queue.writeBuffer(buffer, LIGHT_BUFFER_AT.fogView, viewBlock)
  last.set(viewBlock)
  published.set(buffer, last)
}
