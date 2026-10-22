import type { AirResources } from './resources.ts'

/**
 * THE GROUPS OF THE AIR'S PASSES over one light buffer: each pass's binding group, made again when
 * the buffer is replaced. The tables, the sampler and the frame's and the capture's buffers are
 * the resources' own, shared by every group.
 */
export function airGroupsOver(resources: AirResources, buffer: GPUBuffer) {
  const { tables, sampler, frameBuffer, captureBuffer, passes, group } = resources
  const air = { buffer },
    frame = { buffer: frameBuffer },
    transmittance = tables.transmittance.view,
    multiScatter = tables.multiScatter.view
  return {
    buffer,
    transmittance: group(passes.transmittance.layout, { air, table: transmittance }),
    multiScatter: group(passes.multiScatter.layout, {
      air,
      table: multiScatter,
      transmittance,
      sampler,
    }),
    skyView: group(passes.skyView.layout, {
      air,
      table: tables.skyView.view,
      transmittance,
      multiScatter,
      sampler,
      frame,
    }),
    haze: group(passes.haze.layout, { air, transmittance, multiScatter, sampler, frame }),
    distantSky: group(passes.distantSky.layout, { air, transmittance, multiScatter, sampler }),
    skyRays: group(passes.skyRays.layout, { air, transmittance, multiScatter, sampler }),
    capture: group(passes.capture.layout, {
      air,
      transmittance,
      multiScatter,
      sampler,
      capture: { buffer: captureBuffer },
    }),
  }
}

/** The groups of the air's passes over one light buffer (`airGroupsOver`). */
export type AirGroups = ReturnType<typeof airGroupsOver>
