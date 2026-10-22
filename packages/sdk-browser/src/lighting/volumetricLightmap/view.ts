import type { VolumetricLightmapData } from '../../../../sdk-core/src/lighting/volumetricLightmapFile.ts'

/**
 * What a shader needs to find a position in the volumetric lightmap: four `vec4f`, the block
 * `VlmView` of `sampleWgsl.ts`. The world-to-volume scale (xyz) and the brick size (w); the offset
 * of that map (xyz); the indirection volume's size in texels (xyz); the reciprocal of the atlas's
 * size in texels (xyz). All zero where there is no lightmap or where it is hidden: the shader
 * then answers black, as it does for a scene without one.
 */
export const VOLUMETRIC_LIGHTMAP_VIEW_WORDS = 16

/** Writes the block of `data` at word `at` of `words`; zeros for no data, or when it is not
 *  `shown` (the option `volumetricLightmap`). */
export function writeVolumetricLightmapView(
  words: Float32Array,
  at: number,
  data: VolumetricLightmapData | undefined,
  shown: boolean,
) {
  words.fill(0, at, at + VOLUMETRIC_LIGHTMAP_VIEW_WORDS)
  if (!data || !shown) return
  for (let axis = 0; axis < 3; axis++) {
    const inverseSize = 1 / (data.max[axis] - data.min[axis])
    words[at + axis] = inverseSize
    words[at + 4 + axis] = -data.min[axis] * inverseSize
    words[at + 8 + axis] = data.indirectionSize[axis]
    words[at + 12 + axis] = 1 / data.atlasSize[axis]
  }
  words[at + 3] = data.brickSize
}
