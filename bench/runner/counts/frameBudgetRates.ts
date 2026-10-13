// What the whole-frame budget of the reference case (`counts/frameBudget.ts`) prices its counts at,
// and the per-pixel accesses it counts where no counter walks the shipped shader.
import { hizLevelSizes } from '../../../packages/sdk-browser/src/gpu/hiz/levelSizes.ts'
import { benchLights } from '../lighting/lamps.ts'
import { LIGHTING_RATES } from '../lighting/lightGridCount.ts'
import { ATRIUM_BOUNDS } from '../lighting/lightTileAtrium.ts'
import type { Light } from '../lighting/lightTileCity.ts'

/** Sponza's triangles, from its glTF's index accessors (103 primitives). */
export const SPONZA_TRIANGLES = 262_267
/** Material classes the atrium's boxes are drawn with (`lighting/materialTileCount.ts`). */
export const CLASSES = 6

/**
 * The rates, each from a measured number:
 * - `texelPs`: the lighting model's texel rate (`LIGHTING_RATES`), MODELLED: every per-pixel access.
 * - `trianglePs`: a triangle drawn into the visibility buffer, a software raster on a console
 *   GPU — main and post pass, 1,148 + 183 µs for 25 million triangles —: a reference rate.
 * - `shadedPs`, `weightPs`: a light shaded, and a light weighed or listed out of range, in the
 *   resolve's program with shadow code, timed on the resolve (docs/ENGINE.md): 42.3
 *   and 28.1 ps a pixel.
 */
export const FRAME_RATES = {
  texelPs: LIGHTING_RATES.texelPs,
  trianglePs: ((1148 + 183) * 1e6) / 25e6,
  shadedPs: 42.3,
  weightPs: 28.1,
}

/** Accesses of a covered pixel in the material pass, sponza's class: its visibility texel and page
 *  row, its triangle's three indices, positions, normals and texture coordinates, its three maps
 *  (base, normal, metal-roughness), its five targets (four surfaces and the texture request). */
export const SURFACE_ACCESSES = { visibility: 1, page: 1, vertex: 12, maps: 3, targets: 5 }
/** A shadow setup's texels: eight neighbour depths and the receiver offset's visibility texel,
 *  triangle indices and positions (`shadowSetup`, `receiverOffsetWgsl.ts`). */
export const SETUP_TEXELS = 8 + 7
/** The texels a shadow read of the opaque resolve takes: the light's lane of the projection's mask
 *  (`vsmMaskFactor`); the trace itself is the projection pass's. */
export const MASK_TEXELS = 1
/** Page-table accesses the marking pass spends a light it marks: its home page and its neighbours
 *  across a page edge (`vsm/markingWgsl.ts`). */
export const DEMAND_MARKS = 4

export const UNCOUNTED = [
  'shadow pages drawn: none in the steady state of a moving camera and still lamps (the marks are stable); a lamp that moves redraws its pages',
  'the shadow passes that run per frame whatever is drawn: cull, page pyramids, occlusion',
  'selection and partition of the clusters: a few thousand clusters a frame',
  'the CPU: the recette timed it at 1.8 ms p50 on this case',
]

/** The texels of the Hi-Z pyramid of a `width` × `height` depth at level 0 and in its coarser
 *  levels (`hizLevelSizes`). */
export const hizLevelTexels = (width: number, height: number) => ({
  first: width * height,
  upper: hizLevelSizes(width, height)
    .slice(1)
    .reduce((total, [w, h]) => total + w * h, 0),
})

/** Texels the nearest layer's build reads of a pixel's plane: its depth and four along each axis
 *  (`hizPlaneCorners`). */
const PLANE_READS = 9

/** Texel reads and writes of the culling layer's build of the Hi-Z pyramid of a `width` × `height`
 *  depth, mid-frame (`pyramidTexture.ts`): the copy of level 0, then four reads and a write a
 *  coarser texel. */
export const hizCullAccesses = (width: number, height: number) => {
  const { first, upper } = hizLevelTexels(width, height)
  return 2 * first + 5 * upper
}

/** Those of the build of its nearest layer and of the finished depth's farthest, once the depth is
 *  drawn: `PLANE_READS` reads and a write a pixel for the slopes, and four reads and a write a
 *  coarser texel of each of the two bounds. */
export const hizNearestAccesses = (width: number, height: number) => {
  const { first, upper } = hizLevelTexels(width, height)
  return (PLANE_READS + 1) * first + 2 * 5 * upper
}

/** Those of the whole pyramid, its three layers. */
export const hizAccesses = (width: number, height: number) =>
  hizCullAccesses(width, height) + hizNearestAccesses(width, height)

/** The bench's 200 lamps over the atrium's footprint (`benchLights`), as the grid sees them. */
export function atriumBenchLamps(): Light[] {
  const plan = benchLights(ATRIUM_BOUNDS, { lights: 200, lightShadows: true, sun: false })
  return (plan?.lights ?? []).map((light) => ({
    centre: (light.position ?? [0, 0, 0]).map(Math.fround) as Light['centre'],
    radius: Math.fround(light.range ?? 0),
  }))
}
