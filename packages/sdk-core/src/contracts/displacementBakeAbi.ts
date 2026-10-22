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
 * share none. A mesh that deforms (a skin, a morph, a soft body) is left as it is.
 *
 * - `displacementMaps`: the height maps of the mesh, the first the one its triangles read, `[]`
 *   (the default) none. Each is `{ texture, magnitude, center }`: `texture`, a glTF `textureInfo`
 *   (`{ "index": n }`) of an image whose first channel holds the height — 8 bits, or floats; a
 *   side of at most `MAX_DISPLACEMENT_MAP_SIZE` texels, a larger map displacing nothing —, wrapped
 *   or clamped by its sampler; `magnitude`, how far the height 1 lies from the height `center`
 *   along the normal, in the units of the scene (0: none); `center`, the height that stays on the
 *   surface (0).
 * - `displacementUvChannel`: the set of texture coordinates the maps are read at, a whole number
 *   from 0 to `MAX_DISPLACEMENT_UV_CHANNEL` (0). A mesh without that set reads the coordinates
 *   (0, 0) everywhere.
 * - `displacementEdgeSplit`: how the tessellation shares the vertex it adds on an edge: `seams`
 *   (the default), one vertex for the triangles on both sides of the edge unless a material or a
 *   texture coordinate differs across it, where each side has its own; or `always-duplicate`, one
 *   vertex a side, whatever the edge.
 */
import { choiceSetting, integerSetting, rulesOf } from './settingRules.ts'

/** The key of a mesh build's settings holding its height maps. */
export const DISPLACEMENT_MAPS_SETTING = 'displacementMaps'
/** The keys of a height map. */
export const DISPLACEMENT_MAP_KEYS = ['texture', 'magnitude', 'center'] as const
/** A height map's magnitude and center when it names none. */
export const DEFAULT_DISPLACEMENT_MAP_MAGNITUDE = 0
export const DEFAULT_DISPLACEMENT_MAP_CENTER = 0
/** The most texels a side of a height map holds: a larger one displaces nothing. */
export const MAX_DISPLACEMENT_MAP_SIZE = 8192
/** The last set of texture coordinates a page carries, the last a map may be read at. */
export const MAX_DISPLACEMENT_UV_CHANNEL = 3
/** How the tessellation shares the vertex it adds on an edge. */
export const DISPLACEMENT_EDGE_SPLITS = ['seams', 'always-duplicate'] as const

/** The settings of the baked displacement but its maps, which are a list of objects. */
export const DISPLACEMENT_BAKE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    integerSetting('displacementUvChannel', 0, [0, MAX_DISPLACEMENT_UV_CHANNEL]),
    choiceSetting('displacementEdgeSplit', 'seams', DISPLACEMENT_EDGE_SPLITS),
  ]))()

/** The settings of the baked displacement, in order. */
export const DISPLACEMENT_BAKE_SETTINGS = [
  DISPLACEMENT_MAPS_SETTING,
  'displacementUvChannel',
  'displacementEdgeSplit',
] as const

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

/** Whether `value` is a list of height maps, else why not: the words of a refusal. */
export function displacementMapsRefusal(value: unknown): string | undefined {
  if (!Array.isArray(value)) return `${DISPLACEMENT_MAPS_SETTING} must be a list of height maps`
  for (const [at, map] of value.entries()) {
    const what = `${DISPLACEMENT_MAPS_SETTING}[${at}]`
    if (typeof map !== 'object' || map === null || Array.isArray(map))
      return `${what} must be an object of ${DISPLACEMENT_MAP_KEYS.join(', ')}`
    const keys = Object.keys(map)
    const unknown = keys.find((key) => !(DISPLACEMENT_MAP_KEYS as readonly string[]).includes(key))
    if (unknown !== undefined) return `${what} has no field ${unknown}`
    const { texture, magnitude, center } = map as Record<string, unknown>
    const index = (texture as { index?: unknown } | null | undefined)?.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0)
      return `${what}.texture must be a texture info with a whole index of at least 0`
    for (const [name, number] of [
      ['magnitude', magnitude],
      ['center', center],
    ] as const)
      if (number !== undefined && number !== null && !Number.isFinite(number))
        return `${what}.${name} must be a finite number`
  }
  return undefined
}
