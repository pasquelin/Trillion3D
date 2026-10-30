import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import {
  cloudShadeResources,
  shadowMapResources,
  type AirShadowMaps,
} from '../../../lighting/atmosphere/bindings.ts'
import type { CloudShadowSet } from '../../../lighting/atmosphere/cloudShadowRead.ts'
import {
  AIR_FOG_BINDINGS,
  airBindEntries,
  type AirBindings,
} from '../../../lighting/atmosphere/programs.ts'
import type { AirShape } from '../../../lighting/atmosphere/shape.ts'
import { fogReadBindEntries, type FogRead } from '../../../lighting/fog/read.ts'
import type { CloudSetup } from './cloudModes.ts'
import { COMPOSE_AIR_BINDINGS } from './composeWgsl.ts'
import type { CloudFramePlan } from './reconstruct.ts'
import type { Size } from './reconstructLayout.ts'
import { cloudHazeAir } from './traceHazeProgram.ts'
import type { CloudTraceImage } from './traceLayout.ts'
import { CLOUD_TRACE_AIR } from './traceWgsl.ts'
import {
  cloudTraceExtraEntries,
  cloudTraceExtraHeld,
  type CloudTraceInputs,
  type CloudTraceKey,
} from './traceExtraLayout.ts'
import type { CloudViewPrograms } from './viewPrograms.ts'
import type { CloudViewGpu } from './viewTargets.ts'

/** The air an image of clouds reads: the light buffer, the image's frame, the tables, the buffer of
 *  the volumes the clouds read besides the haze, and the fog. */
export interface CloudAir {
  readonly lights: GPUBuffer
  readonly frame: GPUBuffer
  readonly transmittance: GPUTextureView
  readonly multiScatter: GPUTextureView
  readonly sampler: GPUSampler
  readonly volumes: GPUBuffer
  readonly fog: FogRead
}

/** The shadow maps with the blue noise their consumers jitter by (`vsmOrStandIns`). */
type CloudShadowMaps = AirShadowMaps & { readonly noise: GPUTextureView }

/** Everything an image of a view's clouds is made from (`encodeCloudView`). */
export interface CloudViewFrame {
  readonly device: GPUDevice
  readonly encoder: GPUCommandEncoder
  readonly programs: CloudViewPrograms
  readonly gpu: CloudViewGpu
  readonly part: CloudPart
  readonly setup: CloudSetup
  readonly key: CloudTraceKey
  readonly plan: CloudFramePlan
  readonly image: CloudTraceImage
  /** The eye, and the camera's matrices without the temporal jitter. */
  readonly camera: {
    readonly eye: ArrayLike<number>
    readonly viewProjection: ArrayLike<number>
    readonly projection: ArrayLike<number>
  }
  /** The target the view is drawn in and the part of it the view fills. */
  readonly allocated: Size
  readonly view: Size
  /** The ratio of this image's pre-exposure to the history's. */
  readonly preExposureRatio: number
  readonly sceneDepth: GPUTextureView
  /** The texture the composition lays the clouds over: the lit image, or the first level of the fog's own textures. */
  readonly hdr: GPUTextureView
  readonly air: CloudAir
  readonly material: readonly GPUBindGroupEntry[]
  readonly noise: GPUTextureView
  readonly extra: CloudTraceInputs
  /** The shadow maps and the clouds' shade the haze pass marches the air with. */
  readonly hazeMaps: { readonly maps: CloudShadowMaps; readonly cloudShadow: CloudShadowSet }
}

/** The air's resources of a pass by the names its bindings take, the fog's besides. */
function airEntries(
  bindings: AirBindings,
  shape: AirShape,
  air: CloudAir,
  more: Parameters<typeof airBindEntries>[2],
) {
  return [
    ...airBindEntries(bindings, shape, {
      air: { buffer: air.lights },
      transmittance: air.transmittance,
      sampler: air.sampler,
      frame: { buffer: air.frame },
      ...more,
    }),
    ...fogReadBindEntries(AIR_FOG_BINDINGS, air.fog),
  ]
}

/** Group 0 of the tracing, or of the pass that builds its empty-space table (named `slot`): the
 *  air, the fog and the volumes. */
export function traceAirGroup(f: CloudViewFrame, layout: GPUBindGroupLayout, slot = 'trace air') {
  const { air } = f
  return f.gpu.group(
    slot,
    layout,
    [air.lights, air.frame, air.transmittance, air.sampler, air.volumes, air.fog],
    () => airEntries(CLOUD_TRACE_AIR, f.programs.shape, air, { volumes: { buffer: air.volumes } }),
  )
}

/** Group 2 of the tracing, where its options bind inputs: the sun's shadow maps, the lamps' lists
 *  and the sky light's harmonics. */
export function traceExtraGroup(f: CloudViewFrame, layout: GPUBindGroupLayout) {
  return f.gpu.group('trace extra', layout, cloudTraceExtraHeld(f.extra), () =>
    cloudTraceExtraEntries(f.key, f.extra),
  )
}

/** Group 0 of the haze pass: the air's tables, the blue noise, the shadow maps and the clouds'
 *  shade. */
export function hazeAirGroup(f: CloudViewFrame, layout: GPUBindGroupLayout) {
  const { air } = f,
    { maps, cloudShadow } = f.hazeMaps
  return f.gpu.group(
    'haze air',
    layout,
    [
      ...[air.lights, air.frame, air.transmittance, air.multiScatter, air.sampler],
      ...[maps.pageTable, maps.projectionData, maps.uniforms, maps.pool, maps.view, maps.noise],
      ...[cloudShadow.block, cloudShadow.maps[0], cloudShadow.maps[1], cloudShadow.ao],
    ],
    () =>
      airBindEntries(cloudHazeAir(f.programs.shape), f.programs.shape, {
        air: { buffer: air.lights },
        transmittance: air.transmittance,
        multiScatter: air.multiScatter,
        sampler: air.sampler,
        frame: { buffer: air.frame },
        noise: maps.noise,
        ...shadowMapResources(maps),
        ...cloudShadeResources(cloudShadow),
      }),
  )
}

/** Group 0 of the composition, or of the reconstruction that lays the fog on its image (named
 *  `slot`): the light buffer, the frame and the fog. */
export function composeAirGroup(f: CloudViewFrame, layout: GPUBindGroupLayout, slot: string) {
  const { air } = f
  return f.gpu.group(slot, layout, [air.lights, air.frame, air.fog], () =>
    airEntries(COMPOSE_AIR_BINDINGS, f.programs.shape, air, {}),
  )
}
