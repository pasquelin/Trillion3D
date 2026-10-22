import type { ResolvedAtmosphere } from '../../../../../sdk-core/src/scene/core/atmosphere.ts'
import type { SkyLightPart } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import type { AirShadowMaps } from '../../../lighting/atmosphere/bindings.ts'
import type { AirlessPlanet } from '../../../lighting/atmosphere/frame.ts'
import type { FogRead } from '../../../lighting/fog/read.ts'
import type { CloudTraceImage } from '../clouds/traceLayout.ts'
import type { SkyLightReadSet } from './read.ts'

/** What a frame tells the capture. */
export interface SkyLightInputs {
  readonly part: SkyLightPart
  /** The cube's side (`skyLightCubeWidth`). */
  readonly width: number
  /** The frame's index (the clouds' noise) and the time in seconds. */
  readonly frame: number
  /** Where the sky light stands, in the scene, metres. */
  readonly position: readonly [number, number, number]
  /** The air: its light buffer and tables, the resolved atmosphere the frame reads — or, where the
   *  scene has none and the clouds are shown, the stand-in air and the planet the clouds stand on
   *  (`airlessPlanet`); none where neither an atmosphere nor clouds are shown. */
  readonly air?: {
    readonly resolved: ResolvedAtmosphere | AirlessPlanet
    readonly buffer: GPUBuffer
    readonly transmittance: GPUTextureView
    readonly multiScatter: GPUTextureView
    readonly sampler: GPUSampler
    /** The buffer of the haze's volumes, whose third region is the haze all around the capture's
     *  place (`AtmosphereGpu.volumes`): the clouds' tracing reads it. */
    readonly volumes: GPUBuffer
    /** The virtual shadow maps the air's lights shade the air with, or their stand-ins: read by the
     *  sky of the faces where `skyLightShadowFromOpaque` asks for it. */
    readonly maps?: AirShadowMaps
  }
  /** The host's cube, when the light's source is a specified cubemap and it captures no sky in
   *  real time (`skyLightSource`): six square faces of one side, a cube-compatible 2d array texture
   *  with `TEXTURE_BINDING` (`createSkyCubemapFromImages` makes one from six images). Its top level
   *  is read, bilinearly; a 32-bit float one needs the device's `float32-filterable`. None, the
   *  light has no sky. */
  readonly cubemap?: GPUTexture
  /** The cube the host's cube blends to and the share of it (`SetCubemapBlend`): the light reads the
   *  source mixed with the destination by `fraction`, a destination whole where it is 1. Only for a
   *  specified cubemap. */
  readonly blend?: { readonly destination: GPUTexture; readonly fraction: number }
  /** Whether the scene has an atmosphere, drawn into the faces (not so over the stand-in air). */
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
    /** What the tracing is told of the air, as for the view (`CloudTraceImage`), and the channel of the
     *  sun's shadow maps where it has one. */
    readonly air: Pick<CloudTraceImage, 'airPresent' | 'lightScales' | 'sunShadowChannel'>
    /** What the sky light is read with where the scene has no air (`skyLightReadOf`): the cube it
     *  last captured, whose harmonics give the clouds' distant sky light. */
    readonly skyLight: SkyLightReadSet
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
