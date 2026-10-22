import type { ResolvedAtmosphere } from '../../../../../sdk-core/src/scene/core/atmosphere.ts'
import type { SkyLightPart } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import type { FogRead } from '../../../lighting/fog/read.ts'
import type { CloudTraceImage } from '../clouds/traceLayout.ts'

/** What a frame tells the capture. */
export interface SkyLightInputs {
  readonly part: SkyLightPart
  /** The cube's side (`skyLightCubeWidth`). */
  readonly width: number
  /** The frame's index (the clouds' noise) and the time in seconds. */
  readonly frame: number
  /** Where the sky light stands, in the scene, metres. */
  readonly position: readonly [number, number, number]
  /** The air: its light buffer and tables, the resolved atmosphere the frame reads; none where
   *  neither an atmosphere nor clouds are shown. */
  readonly air?: {
    readonly resolved: ResolvedAtmosphere
    readonly buffer: GPUBuffer
    readonly transmittance: GPUTextureView
    readonly multiScatter: GPUTextureView
    readonly sampler: GPUSampler
  }
  /** The host's cube, when the light's source is a specified cubemap and it captures no sky in
   *  real time (`skyLightSource`): six square faces of one side, a cube-compatible 2d array texture
   *  with `TEXTURE_BINDING` (`createSkyCubemapFromImages` makes one from six images). Its top level
   *  is read, bilinearly; a 32-bit float one needs the device's `float32-filterable`. None, the
   *  light has no sky. */
  readonly cubemap?: GPUTexture
  /** Whether the scene has an atmosphere, drawn into the faces. */
  readonly atmosphere: boolean
  /** The fog's resources, bound by the programs that read the fog (the distant fog and the clouds'
   *  tracing): its cubemap and sampler, and the stand-ins that answer no volume and no frame
   *  (`createFogStandIns`), for the capture holds no volumetric fog. */
  readonly fog?: FogRead
  /** Whether the fog shows in the sky capture: the distant height fog is then laid over the sky. */
  readonly fogShown: boolean
  /** The clouds, where the scene has them: the part, the material's seven bindings of the
   *  tracing's group (from `B.material`), the blue noise's view and the time in seconds. */
  readonly clouds?: {
    readonly part: CloudPart
    readonly material: readonly GPUBindGroupEntry[]
    readonly blueNoise: GPUTextureView
    readonly time: number
    /** What the tracing is told of the air, as for the view (`CloudTraceImage`). */
    readonly air: Pick<CloudTraceImage, 'airPresent' | 'lightScales'>
  }
}

/** Identities a bind group made of them is kept for. */
export type Held = readonly unknown[]
export const sameHeld = (a: Held | undefined, b: Held) => !!a && a.every((x, i) => x === b[i])

/** Bytes of `data` written into `buffer` at `at`. */
export const writeBlock = (
  device: GPUDevice,
  buffer: GPUBuffer,
  at: number,
  data: ArrayBufferView,
) => device.queue.writeBuffer(buffer, at, data.buffer, data.byteOffset, data.byteLength)
