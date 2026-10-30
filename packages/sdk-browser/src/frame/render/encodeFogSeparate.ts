import {
  createFogSeparateGpu,
  type FogSeparateGpu,
  type SeparateLook,
} from '../../lighting/fog/separate.ts'
import { separateFogOf } from '../../lighting/fog/separatePlan.ts'
import { clipToPreviousClip } from '../../../../math/src/matrix/matrix4Motion.ts'
import { readTemporalSetting } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { TemporalInput } from '../../lighting/fog/separateTemporal.ts'
import { screenProbeVectors } from '../../lighting/bounce/screen/vectorSource.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { cameraSeen, NEVER_SEEN, previousCameraOf } from '../backend/state/previousCamera.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { WebgpuGpuState } from '../backend/state/gpu.ts'
import { shownHeightFogOf } from './encodeFogVolume.ts'
import { fogLays } from './encodeHeightFog.ts'
import { fogSettingsOf } from './fogSettings.ts'

/**
 * THE FOG DRAWN INTO TEXTURES OF ITS OWN, in the order of the image (`../../lighting/fog/separate.ts`
 * says what the textures hold): `planSeparateFog` decides it at the entry of the image's sky and
 * clouds; the fog is composed into the textures where the plain fog would be laid, ahead of the sky
 * (`encodeSeparateFog`), the clouds are composed into the first level instead of the lit image
 * (`separateFogTarget`), and the textures are blurred and laid over the lit image once the clouds are
 * in (`finishSeparateFog`). The alpha holdout of the fog does not apply to it.
 */

/** What the fog textures of a view keep: the pipelines and textures, and the plan of the image now drawn. */
export interface FogSeparateState {
  readonly gpu: FogSeparateGpu
  /** The values of the image planned, none where the fog is drawn plainly; cleared when the image finishes. */
  look?: SeparateLook
  /** The fog pass's bindings of the image planned (`binding`), kept so the composition uses what the plan checked. */
  binding?: NonNullable<ReturnType<NonNullable<WebgpuGpuState['deferred']>['fogBinding']>>
  /** The temporal filter of the second level for the image planned, none where it does not run; its words are rewritten each image. */
  temporal?: TemporalInput
  /** The image the filter's history was last written at, and the temporal revision then. */
  seen: number
  revision: number | undefined
  /** The scratch the filter's motion is computed in: the clip positions in the last image's, and the matrices it needs. */
  readonly motion: Float64Array
  readonly current: Float64Array
  readonly inverse: Float64Array
  /** Whether the fog was composed into the textures this image. */
  composed: boolean
  /** Bytes of the textures. */
  readonly bytes: number
}

/** Decides whether this image draws its fog into textures of its own, allocating them: the plain
 *  fog is drawn where it is not, or while the passes compile. `air` says that an atmosphere is drawn. */
export function planSeparateFog(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  air: boolean,
) {
  const { gpu, lights } = rt
  if (gpu.fogSeparate) gpu.fogSeparate.look = gpu.fogSeparate.temporal = undefined
  const binding = gpu.deferred?.fogBinding()
  if (!fogLays(rt, air)) {
    disposeFogSeparate(gpu)
    return false
  }
  if (!binding || !gpu.hdrView) return false
  const fog = lights.store.environment?.fog
  const settings = fogSettingsOf(rt)
  const separate = separateFogOf(settings, fog ? shownHeightFogOf(fog) : undefined)
  if (!separate) {
    disposeFogSeparate(gpu)
    return false
  }
  const state = (gpu.fogSeparate ??= newState(rt, device))
  if (!state.gpu.ready(binding.layout)) return false
  const { scattering } = separate
  // The textures are made at the size the targets are allocated at, so a scale change draws a rect of their corner.
  state.gpu.allocate(gpu.allocatedSize[0], gpu.allocatedSize[1], !!scattering)
  state.binding = binding
  state.composed = false
  state.look = {
    width: gpu.targetSize[0],
    height: gpu.targetSize[1],
    blurScale: gpu.targetSize[0] / gpu.displaySize[0],
    blurControl: scattering?.blurControl ?? 0,
    maxLuminance: separate.maxLuminance,
    spread: scattering?.spreadScale ?? 0,
    amountScale: scattering?.sceneColorScatteringAmountScale ?? 0,
    amountPower: scattering?.sceneColorScatteringAmountPower ?? 1,
  }
  state.temporal = separate.temporal
    ? temporalInput(rt, state, cam, separate.temporalWeight)
    : undefined
  // A history no image will read is not kept.
  if (!separate.temporal) state.gpu.releaseHistory()
  return true
}

/** What the temporal filter reads of this image, none while it lacks the depth or its stage is compiling (the
 *  chain then goes on from the second level by the box, as with the filter off). The history is dropped
 *  where the last image was not the one it was written at or the temporal state was cut. */
function temporalInput(
  rt: WebgpuPagesRuntime,
  state: FogSeparateState,
  cam: EngineCamera,
  currentWeight: number,
): TemporalInput | undefined {
  const { gpu, run } = rt
  const packed = readTemporalSetting(rt, 'temporalHistoryPacked')
  if (!gpu.depthView || !state.gpu.temporalReady(packed)) return undefined
  const before = cameraSeen(previousCameraOf(rt), state.seen)
  clipToPreviousClip(
    state.motion,
    state.current,
    state.inverse,
    cam.viewProjection,
    before?.viewProjection,
  )
  const pre = preExposureOf(rt)
  const cut = !before || run.gate.temporalRevision !== state.revision
  return {
    clipToPrevClip: state.motion,
    currentWeight,
    shown: pre.shown,
    preExposure: pre.now,
    cut,
    slot: run.frame & 7,
    depth: gpu.depthView,
    vectors: screenProbeVectors(rt),
    packed,
  }
}

function newState(rt: WebgpuPagesRuntime, device: GPUDevice): FogSeparateState {
  const failed = (error: unknown) => rt.diag.diagnosticFailure('fog-separate-program-failed', error)
  const gpu = createFogSeparateGpu(device, failed, rt.setup.localFog)
  return {
    gpu,
    seen: NEVER_SEEN,
    revision: undefined,
    motion: new Float64Array(16),
    current: new Float64Array(16),
    inverse: new Float64Array(16),
    composed: false,
    get bytes() {
      return gpu.bytes
    },
  }
}

/** Composes the fog into the textures, over the lit image as it is before the sky. */
export function encodeSeparateFog(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const state = rt.gpu.fogSeparate
  const hdr = rt.gpu.hdrView
  if (!state?.look || !state.binding || !hdr) return
  state.gpu.compose(encoder, state.binding.layout, state.binding.group, hdr, state.look)
  state.composed = true
}

/** The first level of the fog's colour texture, where this image composes its clouds; none where the
 *  fog is drawn plainly. */
export function separateFogTarget(rt: WebgpuPagesRuntime) {
  const state = rt.gpu.fogSeparate
  return state?.look ? state.gpu.colourView() : undefined
}

/** Blurs the textures and lays them over the lit image, once the clouds are composed into them; once an image. */
export function finishSeparateFog(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const state = rt.gpu.fogSeparate
  const hdr = rt.gpu.hdrView
  const look = state?.look
  if (!state || !look || !hdr) return
  state.look = undefined
  if (!state.composed) return
  const filtered = state.gpu.blur(encoder, look, state.temporal)
  // The history was written at this image and under this temporal state, only where the filter ran.
  if (filtered) {
    state.seen = rt.run.frame
    state.revision = rt.run.gate.temporalRevision
  }
  state.gpu.upsample(encoder, hdr, look)
}

/** Releases the fog textures and passes of a view. */
export function disposeFogSeparate(gpu: Pick<WebgpuGpuState, 'fogSeparate'>) {
  gpu.fogSeparate?.gpu.dispose()
  gpu.fogSeparate = undefined
}
