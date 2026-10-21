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
 *  `--responsive=` flag holds it as JSON. A responsive material keeps at most
 *  `TEMPORAL_AA_SHARES.responsive` of its history. */
export const RESPONSIVE_FIELD = 'responsive'
/** The command line's flag naming the responsive objects, its JSON after the `=`. */
export const RESPONSIVE_OPTION = '--responsive='
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
/** The job field setting materials by name (`resolveMaterials`): `{ name: { temporalAntialiasing,
 *  responsive } }`, an explicit value that wins over the match and the material's own extras; the
 *  command line's `--materials=` flag holds it as JSON. */
export const MATERIALS_FIELD = 'materials'
/** The command line's flag setting materials by name, its JSON after the `=`. */
export const MATERIALS_OPTION = '--materials='
/** The key of a glTF material's `extras` asking for a responsive history — `"extras":
 *  { "responsive": true }` —, the lowest source of a material's history share. */
export const RESPONSIVE_EXTRA = 'responsive'
/** The key of a glTF material's `extras` naming its history share — `"extras":
 *  { "temporalAntialiasing": 0.5 }` or a name of `TEMPORAL_AA_SHARES` —, below the `materials`
 *  setting and the `responsive` match, above its own `responsive` extra. */
export const TEMPORAL_AA_EXTRA = 'temporalAntialiasing'
/** The named history shares a material may name in place of a number in [0, 1]: the most of its
 *  history the temporal anti-aliasing keeps on its pixels — `normal` the engine's own blend,
 *  `responsive` the current image weighing at least a quarter, `soft` a half, `off` the current
 *  filtered image alone. */
export const TEMPORAL_AA_SHARES = { normal: 1, responsive: 0.75, soft: 0.5, off: 0 } as const
/** A named history share. */
export type TemporalAntialiasingShareName = keyof typeof TEMPORAL_AA_SHARES
/** The settings a material may name in `materials`: `temporalAntialiasing`, its history share
 *  (a name of `TEMPORAL_AA_SHARES` or a number in [0, 1]), and `responsive`, `true` the shortcut
 *  for `TEMPORAL_AA_SHARES.responsive`. */
export const MATERIAL_SETTINGS = ['temporalAntialiasing', 'responsive'] as const
/** One material's settings as the compiler reads them: the history share as a number. */
export type MaterialSettingsWire = { temporalAntialiasing?: number; responsive?: boolean }
