/**
 * The displacement a mesh's build bakes into its triangles, written once as rules
 * (`settingRules.ts`) and read by the mesh build's resolver (`meshBuildOptions.ts`), the options
 * schema and the compiler's Rust (`scripts/build/shared-rules/displacementBake.ts`). They are
 * `meshBuild` settings (`meshBuildAbi.ts`): a rule's, the scene's, the mesh's own glTF `extras`,
 * the default — the reference's, which bakes nothing.
 *
 * The build tessellates the mesh and moves each vertex along its normal by the height of a map,
 * before it builds the mesh's clusters: where the displacement strays from what the corners'
 * interpolate, the triangles are split, until none strays by more than the error the build is held
 * to (`trimmedError`, in percent of the mesh's size, which the coarser levels are then simplified
 * back to). It happens only for a mesh that names a map AND a `trimmedError` above 0, and has one
 * triangle primitive: the map is the one of the first material, a mesh's several primitives
 * share none. A mesh that deforms (a skin, a morph, a soft body) is left as it is. What reads the
 * mesh's triangles reads the baked ones — the clusters, the collider, the voxels the mesh draws far
 * away, the merged HLOD layers.
 *
 * - `displacementMaps`: the height maps of the mesh, the first the one its triangles read, `[]`
 *   (the default) none. Each is `{ texture, magnitude, center }`: `texture`, a glTF `textureInfo`
 *   (`{ "index": n }`, no other field: the set the map is read at is `displacementUvChannel`'s
 *   alone) of an image whose first channel holds the height — 8 or 16 bits a channel, or floats,
 *   half floats included; a side of at most `MAX_DISPLACEMENT_MAP_SIZE` texels, a larger map
 *   displacing nothing —, wrapped or clamped by its sampler; `magnitude`, how far the height 1 lies
 *   from the height `center` along the normal, in the units of the scene (0: none); `center`, the
 *   height that stays on the surface (0). Both are 32-bit floats, `magnitude` in centimetres too:
 *   one that overflows them is refused.
 * - `displacementUvChannel`: the set of texture coordinates the maps are read at, a whole number
 *   from 0 to `MAX_DISPLACEMENT_UV_CHANNEL` (0). A mesh without that set reads the coordinates
 *   (0, 0) everywhere.
 * - `displacementEdgeSplit`: how the tessellation shares the vertex it adds on an edge: `seams`
 *   (the default), one vertex for the triangles on both sides of the edge unless a material or a
 *   texture coordinate differs across it, where each side has its own; or `always-duplicate`, one
 *   vertex a side, whatever the edge.
 */
import { CENTIMETRES_PER_METRE } from '../page/format.ts'
import { isRecord } from './nameMatch.ts'
import { choiceSetting, integerSetting, ruleFields, rulesOf } from './settingRules.ts'

/** The key of a mesh build's settings holding its height maps. */
export const DISPLACEMENT_MAPS_SETTING = 'displacementMaps'
/** The keys of a height map. */
export const DISPLACEMENT_MAP_KEYS = ['texture', 'magnitude', 'center'] as const
/** The only key of a height map's `texture`. */
export const DISPLACEMENT_TEXTURE_KEYS = ['index'] as const
/** A height map's magnitude and center when it names none. */
export const DEFAULT_DISPLACEMENT_MAP_MAGNITUDE = 0
export const DEFAULT_DISPLACEMENT_MAP_CENTER = 0
/** The most texels a side of a height map holds: a larger one displaces nothing. */
export const MAX_DISPLACEMENT_MAP_SIZE = 8192
/** The last set of texture coordinates a page carries, the last a map may be read at. */
export const MAX_DISPLACEMENT_UV_CHANNEL = 7
/** How the tessellation shares the vertex it adds on an edge. */
export const DISPLACEMENT_EDGE_SPLITS = ['seams', 'always-duplicate'] as const

/** The settings of the baked displacement but its maps, which are a list of objects. */
export const DISPLACEMENT_BAKE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    integerSetting('displacementUvChannel', 0, [0, MAX_DISPLACEMENT_UV_CHANNEL]),
    choiceSetting('displacementEdgeSplit', 'seams', DISPLACEMENT_EDGE_SPLITS),
  ]))()

/** The settings of the baked displacement, in order. */
export const DISPLACEMENT_BAKE_SETTINGS = /* @__PURE__ */ (() =>
  [DISPLACEMENT_MAPS_SETTING, ...ruleFields(DISPLACEMENT_BAKE_RULES)] as const)()

/** How the tessellation shares the vertex it adds on an edge. */
export type DisplacementEdgeSplit = (typeof DISPLACEMENT_EDGE_SPLITS)[number]

/** A height map as the compiler reads it: the magnitude and the center left out where not named. */
export type DisplacementMapWire = {
  texture: { index: number }
  magnitude?: number
  center?: number
}

/** A source's baked displacement settings as the compiler reads them, each left out when not named. */
export type MeshDisplacementBakeSettingsWire = {
  displacementMaps?: readonly DisplacementMapWire[]
  displacementUvChannel?: number
  displacementEdgeSplit?: DisplacementEdgeSplit
}

/** Whether `number` is a number whose 32-bit float, times `scale`, is finite: what the compiler
 *  reads it as. */
const fitsFloat = (number: unknown, scale: number) =>
  typeof number === 'number' && Number.isFinite(Math.fround(Math.fround(number) * scale))

/** Whether `value` is a list of height maps, else why not: the words of a refusal. */
export function displacementMapsRefusal(value: unknown): string | undefined {
  if (!Array.isArray(value)) return `${DISPLACEMENT_MAPS_SETTING} must be a list of height maps`
  for (const [at, map] of value.entries()) {
    const what = `${DISPLACEMENT_MAPS_SETTING}[${at}]`
    if (!isRecord(map)) return `${what} must be an object of ${DISPLACEMENT_MAP_KEYS.join(', ')}`
    const keys = Object.keys(map)
    const unknown = keys.find((key) => !(DISPLACEMENT_MAP_KEYS as readonly string[]).includes(key))
    if (unknown !== undefined) return `${what} has no field ${unknown}`
    const { texture, magnitude, center } = map as Record<string, unknown>
    const index = (texture as { index?: unknown } | null | undefined)?.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0)
      return `${what}.texture must be a texture info with a whole index of at least 0`
    const stray = Object.keys(texture as object).find(
      (key) => !(DISPLACEMENT_TEXTURE_KEYS as readonly string[]).includes(key),
    )
    if (stray !== undefined) return `${what}.texture has no field ${stray}`
    for (const [name, number, scale] of [
      ['magnitude', magnitude, CENTIMETRES_PER_METRE],
      ['center', center, 1],
    ] as const)
      if (number !== undefined && number !== null && !fitsFloat(number, scale))
        return `${what}.${name} must be a finite number a 32-bit float holds${scale === 1 ? '' : ' in centimetres'}`
  }
  return undefined
}
