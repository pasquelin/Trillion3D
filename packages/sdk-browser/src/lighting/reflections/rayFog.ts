import { computeSamplerEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import type { FogRead } from '../fog/read.ts'

/** Where a stage reads the fog's own cubemap and the sampler it is read through, in its group 0: they tint the height fog laid over the light of a ray
 *  (`reflectionFogWgsl`, `rayLightWgsl.ts`). */
export interface RayFogBindings {
  cubemap: number
  sampler: number
}

/** The fog's own cubemap and the sampler it is read through, as a stage is given them. */
export type RayFogRead = Pick<FogRead, 'cubemap' | 'sampler'>

/** The fog a frame gives the rays: the fog's own cubemap, not the sky light's cube that stands in its place while the sky light lights the fog (a ray's fog
 *  reads the sky light on its own cube), or the `placeholders` stand-in white cube while the fog has none. */
export const rayFogReadOf = (
  gpu: { fogVolume?: { read: RayFogRead } },
  placeholders: { fog: RayFogRead },
): RayFogRead => gpu.fogVolume?.read ?? placeholders.fog

/** The layout entries of the fog's reads at `b`, none where `fog` is off. */
export const rayFogLayoutEntries = (b: RayFogBindings, fog: boolean) =>
  fog
    ? [computeTextureEntry(b.cubemap, 'float', 'cube'), computeSamplerEntry(b.sampler, 'filtering')]
    : []

/** The bind group entries of the fog's reads at `b`, none where `fog` is off: the layout entries' (`rayFogLayoutEntries`) over the fog `read`. */
export const rayFogBindEntries = (
  b: RayFogBindings,
  fog: boolean,
  read: RayFogRead,
): GPUBindGroupEntry[] =>
  fog
    ? [
        { binding: b.cubemap, resource: read.cubemap },
        { binding: b.sampler, resource: read.sampler },
      ]
    : []
