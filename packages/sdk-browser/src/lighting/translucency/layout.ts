import { fieldLayout, vec4Array } from '../../gpu/core/fieldLayout.ts'

/**
 * THE TRANSLUCENCY LIGHTING VOLUME'S SHAPES: two cascades of `dim` cells a side around the camera, the
 * direct light of every light injected into their cells each image (`injectWgsl.ts`), filtered
 * (`filterWgsl.ts`: the blend with the image before, then the blur) and read by the see-through surfaces whose
 * material is lit from the volume (`readWgsl.ts`).
 *
 * THE TEXTURE. Each cascade holds, per cell, the light as a two-band spherical harmonic: `ambient`, the
 * band 0 of each colour and, in its alpha, the share of the sun's light that reached the cell; `directional`,
 * one coefficient a band-1 axis, the colours' luminance (the direction of the light has no colour). Both are half floats
 * (`VOLUME_FORMAT`) in one 3D texture of `dim` cells a side and four slabs of `dim` slices along the depth (`volumeExtent`): the
 * inner cascade's ambient light, its directional light, the outer cascade's ambient and its directional (`tvSlab`). The injection and the
 * filters write that layout; the surfaces sample it with a trilinear sampler (`readWgsl.ts`), two samples per cascade where the
 * light has a direction, one where it has none, as a pair of filtered 3D textures per cascade would be read; the slice of a sample is
 * held half a slice inside its slab so that the filter never mixes two. Where the temporal filter is on, the volume
 * it writes — before the blur — is the history of the next image, and two such textures take turns.
 *
 * THE FRAME. One uniform every pass reads (`TRANSLUCENCY_FRAME`): the cascades' boxes — `corner` the least
 * corner with the reciprocal of the cells a side in `w`, `scale` the reciprocal of the box's size with the cell's side in
 * `w` —, those of the image before for the history (`prevCorner`, `prevScale`), `lists` where each cascade's list of
 * lights lies in the buffer of ranks (offset and count, twice), `mode` the cells a side, whether the blur is on,
 * whether the history holds and whether the blur reads the temporal filter's volume, `weights` the pre-exposure the light is written
 * multiplied by (the half floats keep their range at any exposure), the ratio that brings the history's to it
 * and the history's weight, `eye` the camera, which the light functions fade from.
 */

/** The cascades: the inner one holds the view out to `translucencyVolumeInnerDistance`, the outer one the stretch to
 *  `translucencyVolumeOuterDistance`. */
export const TRANSLUCENCY_CASCADES = 2

/** The format of the volume's texture, which the injection and the filters write and the surfaces sample: half floats, four
 *  channels a texel (the ambient light's four, the directional light's three and a spare). */
export const VOLUME_FORMAT: GPUTextureFormat = 'rgba16float'

/** The slabs of the volume's texture a cascade holds: its ambient light, then its directional light. */
export const TRANSLUCENCY_KINDS = 2
/** The slabs along the depth of the volume's texture. */
export const TRANSLUCENCY_SLABS = TRANSLUCENCY_CASCADES * TRANSLUCENCY_KINDS

/** The side of a workgroup of the passes, cells. */
export const TRANSLUCENCY_WORKGROUP = 4

/** The frame's fields (`TranslucencyFrame`), in order. */
export const TRANSLUCENCY_FRAME = fieldLayout('TranslucencyFrame', [
  ['corner', vec4Array(TRANSLUCENCY_CASCADES)],
  ['scale', vec4Array(TRANSLUCENCY_CASCADES)],
  ['prevCorner', vec4Array(TRANSLUCENCY_CASCADES)],
  ['prevScale', vec4Array(TRANSLUCENCY_CASCADES)],
  ['lists', 'vec4u'],
  ['mode', 'vec4u'],
  ['weights', 'vec4f'],
  ['eye', 'vec4f'],
] as const)
/** Bytes of the frame's uniform. */
export const TRANSLUCENCY_FRAME_BYTES = TRANSLUCENCY_FRAME.words * 4

/** The extent of the texture of `dim` cells a side: the slabs of both cascades stacked along the depth. */
export const volumeExtent = (dim: number): [number, number, number] => [
  dim,
  dim,
  TRANSLUCENCY_SLABS * dim,
]

/** The most cells a side a cascade takes on a device whose 3D textures reach `maxDimension` along an axis: the
 *  stacked slabs hold the depth. */
export const mostCellsPerSide = (maxDimension: number) =>
  Math.floor(maxDimension / TRANSLUCENCY_SLABS)
