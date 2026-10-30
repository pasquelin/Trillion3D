/**
 * The job fields about materials and the objects they name — the scene's temporal anti-aliasing,
 * the responsive objects, the voxelized objects, the materials by name —, their flags and the keys
 * a glTF carries them under, printed into the compiler's Rust like the rest of `compilerAbi.ts`.
 */

/** The job field turning the temporal anti-aliasing to a quality level for the whole scene
 *  (`resolveTemporalAntialiasing`): one of `TEMPORAL_AA_LEVELS`, `true` the default level and
 *  `false` off. The compiler writes the level at the top of the manifest only when the job names
 *  it, which the runtime takes as the scene's setting (`'scene'`, below the quality, the page and
 *  the editor; the first loaded scene naming it decides); the command line's
 *  `--temporal-antialiasing=` flag holds it as JSON or as the bare level. A job leaving it out
 *  keeps its cache key. */
export const TEMPORAL_AA_FIELD = 'temporalAntialiasing'
/** The command line's flag naming the scene's temporal anti-aliasing, its value after the `=`. */
export const TEMPORAL_AA_OPTION = '--temporal-antialiasing='
/** The temporal anti-aliasing's quality levels, `off` first, then coarsest to finest: the
 *  anti-aliasing scalability levels 0 to 3 from `low` (`../../../sdk-browser/src/post/taa/levels.ts`). */
export const TEMPORAL_AA_LEVELS = ['off', 'low', 'medium', 'high', 'max'] as const
/** A temporal anti-aliasing quality level. */
export type TemporalAntialiasingLevel = (typeof TEMPORAL_AA_LEVELS)[number]
/** The level `true`, or nothing, names: the engine's own image, the anti-aliasing scalability
 *  level 3 — every pass of the analysis, the shading rejection widened by the flicker measure, the
 *  spatial anti-aliaser's eight samples a side (`TAA_LEVEL_KNOBS`). */
export const DEFAULT_TEMPORAL_AA_LEVEL = 'max' satisfies TemporalAntialiasingLevel

/** The job field naming the objects whose materials the temporal anti-aliasing keeps responsive
 *  (`resolveResponsive`): one match on what the glTF carries, as one HLOD group names its objects
 *  — a node's exact name, a pattern on it, or `HlodWireMatch` —; the command line's
 *  `--responsive=` flag holds it as JSON. A responsive material is at the level
 *  `DEFAULT_RESPONSIVE_LEVEL`. */
export const RESPONSIVE_FIELD = 'responsive'
/** The command line's flag naming the responsive objects, its JSON after the `=`. */
export const RESPONSIVE_OPTION = '--responsive='
/** The levels of a material's temporal responsiveness, `off` first: how far the temporal
 *  anti-aliasing trusts the history on the pixels the material draws. `off` accumulates as it does
 *  everywhere; `medium` takes the material's motion vectors for a mismatch of its detail — a pixel
 *  animation: the pass reads it as moving and rejects its history more aggressively, small features
 *  above all —; `full` takes them for wrong altogether, the pixel's history restarting every image
 *  (it is read as disoccluded and never resurrected). */
export const RESPONSIVE_LEVELS = ['off', 'medium', 'full'] as const
/** A material's temporal responsiveness level. */
export type ResponsiveLevel = (typeof RESPONSIVE_LEVELS)[number]
/** The level `true`, or an object the `responsive` match takes, names: `full`, the history of a
 *  spark or a particle that the motion vectors cannot follow restarting every image. */
export const DEFAULT_RESPONSIVE_LEVEL = 'full' satisfies ResponsiveLevel
/** The job field naming the objects whose meshes are voxelized far away (`resolveVoxelize`): one
 *  match on what the glTF carries, as `responsive` names its objects. Their DAG's coarse levels are
 *  bricks of voxels wherever voxels hold the error better than triangles; the objects of the HLOD
 *  `foliage` group are voxelized without it, and so is a mesh whose own `extras` asks
 *  (`VOXELIZE_EXTRA`). The command line's `--voxelize=` flag holds it as JSON. */
export const VOXELIZE_FIELD = 'voxelize'
/** The command line's flag naming the voxelized objects, its JSON after the `=`. */
export const VOXELIZE_OPTION = '--voxelize='
/** The key of a glTF mesh's `extras` asking for voxels far away — `"extras": { "shapePreservation":
 *  "voxelize" }` —, the lowest source of a mesh's voxels. */
export const VOXELIZE_EXTRA = 'shapePreservation'
/** The job field setting materials by name (`resolveMaterials`): `{ name: { responsive } }`,
 *  `responsive` a level of `RESPONSIVE_LEVELS`, `true` for `DEFAULT_RESPONSIVE_LEVEL` and `false`
 *  for `off`, an explicit value that wins over the match and the material's own extras; the
 *  command line's `--materials=` flag holds it as JSON. */
export const MATERIALS_FIELD = 'materials'
/** The command line's flag setting materials by name, its JSON after the `=`. */
export const MATERIALS_OPTION = '--materials='
/** The key of a glTF material's `extras` naming its responsiveness — `"extras": { "responsive":
 *  true }` or a level of `RESPONSIVE_LEVELS` —, the lowest source of a material's level. */
export const RESPONSIVE_EXTRA = 'responsive'
/** The key of a glTF material's `extras` marking it as a sky material — `"extras": { "sky": true }` —,
 *  the lowest source of the property. A sky material is the one a sky dome mesh wears: the engine shows
 *  it as its colour alone (no light reaches it), draws it as the sky after the opaque surfaces, and
 *  captures it in place of the atmosphere in the sky light's real-time capture. */
export const SKY_EXTRA = 'sky'
/** The settings a material may name in `materials`: `responsive`, `sky`. */
export const MATERIAL_SETTINGS = ['responsive', SKY_EXTRA] as const
/** One material's settings as the compiler reads them: the responsive level as its name, the sky
 *  property as a boolean. */
export type MaterialSettingsWire = { responsive?: ResponsiveLevel; sky?: boolean }

/** The key of a glTF material's `extras` naming its displacement — `"extras": { "displacement":
 *  { "texture": { "index": 3 }, "tessellation": true } }` —, the only source of it: glTF has no
 *  displacement map of its own. The material is displaced only when it names the map AND switches
 *  its tessellation on (`tessellation`, off by default, as the reference's own material switch is);
 *  one that names the map alone draws flat. */
export const DISPLACEMENT_EXTRA = 'displacement'
/** What a material's `displacement` names: `texture`, a glTF `textureInfo` (`index`, and `texCoord`
 *  for the set it reads, 0 unless it names another) of an image whose first channel holds the
 *  height, 0 to 1; `tessellation`, a boolean; `magnitude`, how far the height 1 lies from the
 *  height `center` along the normal, in the units of the scene, a number of at least 0; `center`,
 *  the height that stays on the surface, from 0 to 1; `fade`, how the displacement fades with
 *  distance: `false` never — the default —, `true` the default range, or `{ start, end }`, the
 *  on-screen size in pixels of the largest displacement at which it starts to fade and at which it
 *  is gone, each above 0. */
export const DISPLACEMENT_KEYS = ['texture', 'tessellation', 'magnitude', 'center', 'fade'] as const
/** The keys of a displacement's `fade` range. */
export const DISPLACEMENT_FADE_KEYS = ['start', 'end'] as const
/** A displacement's magnitude and center when it names none: the reference's own, 4 and a half. */
export const DEFAULT_DISPLACEMENT_MAGNITUDE = 4
export const DEFAULT_DISPLACEMENT_CENTER = 0.5
/** A displacement's fade range when it names `true` or leaves a bound out: it starts at 4 pixels
 *  and is gone at 1, the reference's own. */
export const DEFAULT_DISPLACEMENT_FADE_START = 4
export const DEFAULT_DISPLACEMENT_FADE_END = 1
/** A material's displacement as the compiler writes it in the scene's material table: absent when
 *  the material is not displaced. The map is a table slot (`TableTextureSlot`); `fade` is `null`
 *  for a displacement that never fades. */
export type DisplacementWire = {
  magnitude: number
  center: number
  fade: { start: number; end: number } | null
  /** How many units of the object's space one unit of each of its eight texture-coordinate
   *  sets covers, measured over the triangles that wear the material (the compiler's
   *  `uv_density`): the level of the height map each micro-triangle reads is chosen by it, one
   *  number a set and never one a triangle. Absent where no triangle measured a set, and a set it
   *  measured not at all is 0; the runtime reads 1 for either. */
  uvDensities?: readonly number[]
}
