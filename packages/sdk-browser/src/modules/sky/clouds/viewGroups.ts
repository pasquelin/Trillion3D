import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import type { AirShadowMaps } from '../../../lighting/atmosphere/bindings.ts'
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
import { cloudHazeAir } from './traceHaze.ts'
import type { CloudTraceImage } from './traceLayout.ts'
import { CLOUD_TRACE_AIR } from './traceWgsl.ts'
import { CLOUD_TRACE_EXTRA_BINDING as X, type CloudTraceKey } from './traceExtraLayout.ts'
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

/** What the options of the tracing read beyond the air: the virtual shadow maps' tables, bound
 *  where the sun's opaque shadow is read, and the light grid's lists, where the lamps light the
 *  cloud. */
export interface CloudTraceInputs {
  readonly maps?: AirShadowMaps
  readonly tileLights?: GPUBuffer
}

/** The shadow maps with the blue noise their consumers jitter by (`vsmOrStandIns`). */
export type CloudShadowMaps = AirShadowMaps & { readonly noise: GPUTextureView }

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

/** Group 0 of the tracing: the air, the fog and the volumes. */
export function traceAirGroup(f: CloudViewFrame, layout: GPUBindGroupLayout) {
  const { air } = f
  return f.gpu.group(
    'trace air',
    layout,
    [air.lights, air.frame, air.transmittance, air.sampler, air.volumes, air.fog],
    () => airEntries(CLOUD_TRACE_AIR, f.programs.shape, air, { volumes: { buffer: air.volumes } }),
  )
}

/** Group 2 of the tracing, where its options bind inputs: the sun's shadow maps and the lamps'
 *  lists. */
export function traceExtraGroup(f: CloudViewFrame, layout: GPUBindGroupLayout) {
  const { maps, tileLights } = f.extra
  const names = [maps?.pageTable, maps?.projectionData, maps?.uniforms, maps?.pool, maps?.view]
  return f.gpu.group('trace extra', layout, [...names, tileLights], () => [
    ...(f.key.opaqueShadow && maps
      ? [
          { binding: X.vsm.pageTable, resource: { buffer: maps.pageTable } },
          { binding: X.vsm.projectionData, resource: { buffer: maps.projectionData } },
          { binding: X.vsm.uniforms, resource: { buffer: maps.uniforms } },
          { binding: X.vsm.pool, resource: { buffer: maps.pool } },
          { binding: X.vsmView, resource: { buffer: maps.view } },
        ]
      : []),
    ...(f.key.localLights && tileLights
      ? [{ binding: X.tileLights, resource: { buffer: tileLights } }]
      : []),
  ])
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
      ...[cloudShadow.block, cloudShadow.maps[0], cloudShadow.maps[1]],
    ],
    () =>
      airBindEntries(cloudHazeAir(f.programs.shape), f.programs.shape, {
        air: { buffer: air.lights },
        transmittance: air.transmittance,
        multiScatter: air.multiScatter,
        sampler: air.sampler,
        frame: { buffer: air.frame },
        noise: maps.noise,
        pageTable: { buffer: maps.pageTable },
        projectionData: { buffer: maps.projectionData },
        shadowUniforms: { buffer: maps.uniforms },
        shadowPool: { buffer: maps.pool },
        shadowView: { buffer: maps.view },
        cloudShadow: { buffer: cloudShadow.block },
        cloudShadowMap0: cloudShadow.maps[0],
        cloudShadowMap1: cloudShadow.maps[1],
      }),
  )
}

/** Group 0 of the composition: the light buffer, the frame and the fog. */
export function composeAirGroup(f: CloudViewFrame, layout: GPUBindGroupLayout) {
  const { air } = f
  return f.gpu.group('compose air', layout, [air.lights, air.frame, air.fog], () =>
    airEntries(COMPOSE_AIR_BINDINGS, f.programs.shape, air, {}),
  )
}
