import {
  AIR_BINDING,
  AIR_FOG_BINDINGS,
  airBindEntries,
} from '../../../lighting/atmosphere/programs.ts'
import { cloudShadeResources, shadowMapResources } from '../../../lighting/atmosphere/bindings.ts'
import { cloudShadowStandIn } from '../../../lighting/atmosphere/cloudShadowStandIn.ts'
import { FRAME_FLOATS } from '../../../lighting/atmosphere/frame.ts'
import { fogReadBindEntries } from '../../../lighting/fog/read.ts'
import {
  cloudTraceExtraEntries,
  cloudTraceExtraHeld,
  cloudTraceKeyText,
} from '../clouds/traceExtraLayout.ts'
import { CLOUD_TRACE_BINDING as B, CLOUD_TRACE_LAYOUT } from '../clouds/traceLayout.ts'
import { CLOUD_TRACE_AIR } from '../clouds/traceWgsl.ts'
import { capturedClouds, type CapturedClouds } from './captureClouds.ts'
import { sameHeld, type Held, type SkyLightInputs } from './captureInputs.ts'
import { FACE_LAYOUT, SKY_FACE_AIR, SKY_FACE_AIR_SHADOWED } from './faceWgsl.ts'
import { BLOCK_STRIDE, CUBE_FACES } from './layout.ts'
import type { SkyLightPipelines } from './pipelines.ts'
import type { SkyLightTargets } from './targets.ts'

/** What the face passes keep from frame to frame: the groups, made again when the identities they
 *  were made of change. */
export interface FaceHolds {
  faceGroup?: { for: SkyLightTargets; group: GPUBindGroup }
  skyHeld?: Held
  skyGroup?: GPUBindGroup
  shadowedHeld?: Held
  shadowedGroup?: GPUBindGroup
  fogHeld?: Held
  fogGroup?: GPUBindGroup
  traceHeld?: Held
  traceGroups: { air: GPUBindGroup; cloud: GPUBindGroup }[]
  /** The clouds' tracing's group 2, where its key has one (`CloudTraceKey`): the sun's shadow maps
   *  and the sky light's harmonics. */
  extraGroup?: GPUBindGroup
}

/** The groups over the sky's air and the distant fog, made again when their resources change; none
 *  over the stand-in air of a scene with no atmosphere, whose sky is not drawn. The sky's march
 *  reads the clouds' shade of the image (`input.clouds.cloudShadow`), the stand-in where the scene
 *  has no clouds. */
function skyAndFogGroups(
  device: GPUDevice,
  { layouts, shape }: SkyLightPipelines,
  holds: FaceHolds,
  input: SkyLightInputs,
) {
  const { fog } = input
  const air = input.atmosphere ? input.air : undefined
  const shade = input.clouds?.cloudShadow ?? cloudShadowStandIn(device)
  const shadeHeld = [shade.block, shade.maps[0], shade.maps[1], shade.ao]
  const skyKey = air && [air.buffer, air.transmittance, air.multiScatter, air.sampler, ...shadeHeld]
  if (air && skyKey && !sameHeld(holds.skyHeld, skyKey)) {
    holds.skyHeld = skyKey
    holds.skyGroup = device.createBindGroup({
      layout: layouts.skyAir,
      entries: airBindEntries(SKY_FACE_AIR, shape, {
        air: { buffer: air.buffer },
        transmittance: air.transmittance,
        multiScatter: air.multiScatter,
        sampler: air.sampler,
        ...cloudShadeResources(shade),
      }),
    })
  }
  const maps = input.part.quality.skyLightShadowFromOpaque ? air?.maps : undefined
  const shadowedKey = skyKey && maps && [...skyKey, ...Object.values(maps)]
  if (air && maps && shadowedKey && !sameHeld(holds.shadowedHeld, shadowedKey)) {
    holds.shadowedHeld = shadowedKey
    holds.shadowedGroup = device.createBindGroup({
      layout: layouts.skyAirShadowed,
      entries: airBindEntries(SKY_FACE_AIR_SHADOWED, shape, {
        air: { buffer: air.buffer },
        transmittance: air.transmittance,
        multiScatter: air.multiScatter,
        sampler: air.sampler,
        ...cloudShadeResources(shade),
        ...shadowMapResources(maps),
      }),
    })
  }
  if (air && fog && !sameHeld(holds.fogHeld, [air.buffer, fog])) {
    holds.fogHeld = [air.buffer, fog]
    holds.fogGroup = device.createBindGroup({
      layout: layouts.fogAir,
      entries: [
        { binding: AIR_BINDING.air, resource: { buffer: air.buffer } },
        ...fogReadBindEntries(AIR_FOG_BINDINGS, fog),
      ],
    })
  }
}

/** The clouds' tracing groups, one pair a face: the air and the frame's block, then the material,
 *  the trace block and the images. */
function traceGroupsOf(
  device: GPUDevice,
  made: SkyLightPipelines,
  t: SkyLightTargets,
  { air, clouds, key }: CapturedClouds,
  fog: NonNullable<SkyLightInputs['fog']>,
) {
  const cloudTrace = made.cloudTrace(key)
  return Array.from({ length: CUBE_FACES }, (_, face) => ({
    air: device.createBindGroup({
      layout: cloudTrace.air,
      entries: [
        ...airBindEntries(CLOUD_TRACE_AIR, made.shape, {
          air: { buffer: air.buffer },
          transmittance: air.transmittance,
          sampler: air.sampler,
          volumes: { buffer: air.volumes },
          frame: { buffer: t.blocks.frame, offset: face * BLOCK_STRIDE, size: FRAME_FLOATS * 4 },
        }),
        ...fogReadBindEntries(AIR_FOG_BINDINGS, fog),
      ],
    }),
    cloud: device.createBindGroup({
      layout: cloudTrace.cloud,
      entries: [
        ...clouds.material,
        {
          binding: B.block,
          resource: {
            buffer: t.blocks.trace,
            offset: face * BLOCK_STRIDE,
            size: CLOUD_TRACE_LAYOUT.words * 4,
          },
        },
        { binding: B.blueNoise, resource: clouds.blueNoise },
        { binding: B.depthRange, resource: t.cloudViews.depthRange },
        { binding: B.colour, resource: t.cloudViews.colour },
        { binding: B.depth, resource: t.cloudViews.depth },
      ],
    }),
  }))
}

/** The face block and the groups over the air, the fog and the clouds, for this frame's inputs. */
export function groupsFor(
  device: GPUDevice,
  made: SkyLightPipelines,
  holds: FaceHolds,
  t: SkyLightTargets,
  input: SkyLightInputs,
) {
  if (holds.faceGroup?.for !== t)
    holds.faceGroup = {
      for: t,
      group: device.createBindGroup({
        layout: made.layouts.face,
        entries: [{ binding: 0, resource: { buffer: t.blocks.face, size: FACE_LAYOUT.words * 4 } }],
      }),
    }
  skyAndFogGroups(device, made, holds, input)
  const traced = capturedClouds(input)
  if (!traced || !input.fog) return
  const { air, clouds, key } = traced
  const extra = { maps: air.maps, skyLight: clouds.skyLight, cloudShadow: clouds.cloudShadow }
  const traceKey = [
    ...[t, cloudTraceKeyText(key), air.buffer, air.transmittance, air.sampler, air.volumes],
    ...[input.fog, clouds.material, clouds.blueNoise],
    ...cloudTraceExtraHeld(extra),
  ]
  if (sameHeld(holds.traceHeld, traceKey)) return
  holds.traceHeld = traceKey
  holds.traceGroups = traceGroupsOf(device, made, t, traced, input.fog)
  const { extra: layout } = made.cloudTrace(key)
  holds.extraGroup = layout
    ? device.createBindGroup({ layout, entries: cloudTraceExtraEntries(key, extra) })
    : undefined
}
