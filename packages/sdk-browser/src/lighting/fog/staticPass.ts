import { namedEntries } from '../../gpu/core/computeBindings.ts'
import type { VolumetricLightmapGpu } from '../volumetricLightmap/gpu.ts'
import { FOG_BINDING } from './bindings.ts'
import { heldGroup, keptGroup, threads } from './groupKeeping.ts'
import type { FogPassContext, FogPassInputs } from './passes.ts'
import type { VolumeTextures } from './resources.ts'

/** The baked light of each cell, into the static term's volume: the mean over the samples the scatter
 *  takes (`FOG_STATIC_WGSL`), read by the scatter after. */
export function encodeStatic(
  pass: GPUComputePassEncoder,
  context: FogPassContext,
  input: FogPassInputs,
  lightmap: VolumetricLightmapGpu,
  baked: NonNullable<VolumeTextures['baked']>,
  textures: VolumeTextures,
) {
  const { device, resources, groups, ping, whiteCubemap } = context
  const { programs } = resources
  const { next } = groups.static.identity
  next[0] = input.depth
  next[1] = input.lights
  next[2] = textures.furthest[ping]
  next[3] = textures.furthest[1 - ping]
  next[4] = input.cubemap ?? whiteCubemap
  next[5] = input.sky.harmonics
  next[6] = input.sky.params
  next[7] = baked
  next[8] = lightmap
  pass.setPipeline(programs.static.pipeline.get())
  pass.setBindGroup(
    0,
    heldGroup(groups.static) ??
      keptGroup(device, programs.static.layout, groups.static, [
        ...namedEntries(FOG_BINDING, {
          frame: { buffer: resources.frame.buffer },
          lights: { buffer: input.lights },
          depth: input.depth,
          furthest: textures.furthest[ping].view,
          previousFurthest: textures.furthest[1 - ping].view,
          sampler: resources.sampler,
          cubemap: input.cubemap ?? whiteCubemap,
          skyHarmonics: { buffer: input.sky.harmonics },
          skyParams: { buffer: input.sky.params },
          staticOut: baked.view,
        }),
        ...lightmap.entries(FOG_BINDING.lightmap),
      ]),
  )
  const { cells } = context
  pass.dispatchWorkgroups(threads(cells.x, 4), threads(cells.y, 4), threads(cells.z, 4))
}
