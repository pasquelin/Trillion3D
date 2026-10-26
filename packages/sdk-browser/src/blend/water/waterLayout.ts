import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE WATER PASS'S OWN BIND GROUP (after the blend's and the reflection's): the uniform `water`, the
 * copy of the scene without the water (colour, then depth as the linear clip-w depth `depth`
 * keeps), the refraction mask (read where a culling is on), and a non-filtering sampler (`point`) the
 * colour, depth and mask are read by gather with; then, for the reflection composite, the water's own
 * surface — its normal and roughness (`normals`), its reflectance and the flag that it is water
 * (`specular`) — and depth (`waterDepth`), and the list of the 8 by 8 tiles that hold water (`tiles`). The
 * shading writes the water's surface and the composite reads it: the two passes bind a texture not
 * theirs to a stand-in (`WaterTargets`).
 */
export const WATER_GROUP = 2
export const WATER_BINDINGS = {
  params: 0,
  color: 1,
  depth: 2,
  mask: 3,
  point: 4,
  normals: 5,
  specular: 6,
  waterDepth: 7,
  tiles: 8,
  sun: 9,
  farMask: 10,
} as const

/** The bindings of group 0 of the water pass's own programs, which the WGSL and the layouts both read:
 *  the scene's copies (`waterPassWgsl.ts`), the refraction mask, and the tiles' kernels
 *  (`waterTileWgsl.ts`), the last with the visibility target they clear (`ids`). */
export const WATER_COPY_BINDINGS = { params: 0, color: 1, depth: 2, sampler: 3, tiles: 4 } as const
export const WATER_MASK_BINDINGS = {
  params: 0,
  waterDepth: 1,
  opaqueDepth: 2,
  sceneLinear: 3,
} as const
export const WATER_TILE_BINDINGS = {
  params: 0,
  waterDepth: 1,
  opaqueDepth: 2,
  mask: 3,
  list: 4,
  args: 5,
  ids: 6,
} as const

/** The pixels across a tile of the lists (`waterTileKernels`) and the water's surface targets' formats:
 *  the normal and the roughness in half floats, the reflectance and the water flag in bytes. */
export const WATER_TILE_PIXELS = 8
export const WATER_NORMALS_FORMAT: GPUTextureFormat = 'rgba16float'
export const WATER_SPECULAR_FORMAT: GPUTextureFormat = 'rgba8unorm'

/** The reflection techniques as the fragment reads them (`singleLayerWaterReflection`'s names). */
export const WATER_REFLECTION_CODE = {
  enabled: 0,
  disabled: 1,
  captures: 2,
  screenSpace: 3,
} as const

/**
 * The water pass's view uniform: `inverseViewProjection` takes a pixel and a depth back to the world;
 * `clipW` is the render matrix's last row (a point's linear depth is its dot with the point), `eye`
 * the camera's place;
 * `scene` the copy's size in texels (`xy`) and its reciprocal (`zw`); `bounds` the copy's safe range of
 * texture coordinates, the view's rectangle inset by a guard band of 0.55 texel so that a gather never
 * reads past it (`min`, `max`); `modes` the reflection technique (`x`), whether the refraction mask is
 * read (`y`), whether the clouds shade the sun on the water (`z`); `distanceRange`, `fresnelRange` and
 * `depthRange` the refraction culling's, each the two ends of its fade (`x`, `y`; `z` 1 where it is on);
 * `tiles` the tiles across and down the target (`xy`) and its size in pixels (`zw`); `filters` whether the
 * sun's shadow on the water is the full trace (`x`, `singleLayerWaterVsmFiltering`) and whether the sun is kept
 * apart from the rest of the water's light (`y`, the separated sun).
 */
const FIELDS = [
  ['inverseViewProjection', 'mat4x4f'],
  ['clipW', 'vec4f'],
  ['eye', 'vec4f'],
  ['scene', 'vec4f'],
  ['bounds', 'vec4f'],
  ['modes', 'vec4u'],
  ['distanceRange', 'vec4f'],
  ['fresnelRange', 'vec4f'],
  ['depthRange', 'vec4f'],
  ['tiles', 'vec4u'],
  ['filters', 'vec4u'],
] as const
const WATER_LAYOUT = fieldLayout('WaterParams', FIELDS)
export const WATER_PARAMS_WORDS = WATER_LAYOUT.words
export const WATER_AT = WATER_LAYOUT.at
export const WATER_PARAMS_WGSL = wgslBlock('WATER_PARAMS_WGSL', [], WATER_LAYOUT.wgsl)
