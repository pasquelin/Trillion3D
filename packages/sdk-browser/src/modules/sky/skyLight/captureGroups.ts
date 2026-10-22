import { AIR_BINDING, AIR_FOG_BINDINGS } from '../../../lighting/atmosphere/programs.ts'
import { FRAME_FLOATS } from '../../../lighting/atmosphere/frame.ts'
import { fogReadBindEntries } from '../../../lighting/fog/read.ts'
import { CLOUD_TRACE_BINDING as B, CLOUD_TRACE_LAYOUT } from '../clouds/traceLayout.ts'
import { sameHeld, type Held, type SkyLightInputs } from './captureInputs.ts'
import { FACE_LAYOUT } from './faceWgsl.ts'
import { BLOCK_STRIDE, CUBE_FACES } from './layout.ts'
import type { SkyLightPipelines } from './pipelines.ts'
import type { SkyLightTargets } from './targets.ts'

type Air = NonNullable<SkyLightInputs['air']>
type Clouds = NonNullable<SkyLightInputs['clouds']>

/** What the face passes keep from frame to frame: the groups, made again when the identities they
 *  were made of change. */
export interface FaceHolds {
  faceGroup?: { for: SkyLightTargets; group: GPUBindGroup }
  skyHeld?: Held
  skyGroup?: GPUBindGroup
  fogHeld?: Held
  fogGroup?: GPUBindGroup
  traceHeld?: Held
  traceGroups: { air: GPUBindGroup; cloud: GPUBindGroup }[]
}

/** The groups over the sky's air and the distant fog, made again when their resources change. */
function skyAndFogGroups(
  device: GPUDevice,
  layouts: SkyLightPipelines['layouts'],
  holds: FaceHolds,
  input: SkyLightInputs,
) {
  const { air, fog } = input
  if (
    air &&
    !sameHeld(holds.skyHeld, [air.buffer, air.transmittance, air.multiScatter, air.sampler])
  ) {
    holds.skyHeld = [air.buffer, air.transmittance, air.multiScatter, air.sampler]
    holds.skyGroup = device.createBindGroup({
      layout: layouts.skyAir,
      entries: [
        { binding: AIR_BINDING.air, resource: { buffer: air.buffer } },
        { binding: AIR_BINDING.transmittance, resource: air.transmittance },
        { binding: AIR_BINDING.multiScatter, resource: air.multiScatter },
        { binding: AIR_BINDING.sampler, resource: air.sampler },
      ],
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
  air: Air,
  fog: NonNullable<SkyLightInputs['fog']>,
  clouds: Clouds,
) {
  const { cloudTrace } = made
  return Array.from({ length: CUBE_FACES }, (_, face) => ({
    air: device.createBindGroup({
      layout: cloudTrace.air,
      entries: [
        { binding: AIR_BINDING.air, resource: { buffer: air.buffer } },
        { binding: AIR_BINDING.transmittance, resource: air.transmittance },
        { binding: AIR_BINDING.sampler, resource: air.sampler },
        {
          binding: AIR_BINDING.frame,
          resource: {
            buffer: t.blocks.frame,
            offset: face * BLOCK_STRIDE,
            size: FRAME_FLOATS * 4,
          },
        },
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
  skyAndFogGroups(device, made.layouts, holds, input)
  const { air, fog, clouds } = input
  const traceKey = air &&
    fog &&
    clouds && [
      t,
      air.buffer,
      air.transmittance,
      air.sampler,
      fog,
      clouds.material,
      clouds.blueNoise,
    ]
  if (traceKey && !sameHeld(holds.traceHeld, traceKey)) {
    holds.traceHeld = traceKey
    holds.traceGroups = traceGroupsOf(device, made, t, air, fog, clouds)
  }
}
