/**
 * What the compiler and the runtime both state, written once here and printed into the compiler's
 * Rust (`scripts/build/shared-rules/abi.ts`, `packages/asset-compiler-rust/src/shared_math/abi.rs`): the
 * one declaration of a compile job's fields, their defaults and their bounds, which the options
 * schema, the SDK's command line and `prepare` read too.
 */

/** The triangle budget a compilation keeps when none is named. */
export const DEFAULT_TRIANGLE_BUDGET = 150000
/** The most threads one job may use. */
export const MAX_THREADS = 64
/** The memory the compiler may use, in MB, when none is named: room for the widest HLOD actor,
 *  which runs alone (`compiler_world_roots`). */
export const DEFAULT_RAM_BUDGET_MB = 4096
/** The least memory one job needs to decode the smallest scene, in MB. */
export const MIN_RAM_BUDGET_MB = 64
/** How meshes are simplified when nothing is named: the coarser levels above the exact clusters,
 *  so a cache draws fewer triangles at distance. A plain constant, so a bundle that reads none of
 *  the job's schema keeps none of it (a member read of the list would). */
export const DEFAULT_SIMPLIFICATION = 'qem-endpoints'
/** How meshes may be simplified; the first is the default (`DEFAULT_SIMPLIFICATION`), `none` keeps
 *  the exact clusters alone, every one a root. */
export const SIMPLIFICATIONS = [DEFAULT_SIMPLIFICATION, 'none'] as const
/** How meshes are simplified, one of `SIMPLIFICATIONS`. */
export type Simplification = (typeof SIMPLIFICATIONS)[number]
/**
 * The fields of one compile job, as a batch file and the options schema name them, in the order
 * the compiler's command line takes them. Its short forms leave out `simplification` (seven
 * values), then `threads` and `ramBudgetMb` too (five).
 */
export const JOB_FIELDS = [
  'source',
  'cache',
  'scope',
  'triangleBudget',
  'threads',
  'ramBudgetMb',
  'resourceBaseUrl',
  'simplification',
] as const
/** One field of a compile job. */
export type JobField = (typeof JOB_FIELDS)[number]

/** How an HLOD layer builds its actors: `instanced`, the objects themselves, batched — a layer
 *  objects are assigned to —; `approximate`, one closed shell per cell wearing a flattened
 *  material; `merge`, the cell's objects merged into one mesh; `proxy`, the cell's objects
 *  remeshed into one closed surface; `voxel`, the cell's objects voxelized together, levels of
 *  bricks the cut picks by their error — no shell, no atlas, a leaf's cut-out kept. */
export const HLOD_BUILDERS = ['instanced', 'approximate', 'merge', 'proxy', 'voxel'] as const
/** One of `HLOD_BUILDERS`. */
export type HlodBuilder = (typeof HLOD_BUILDERS)[number]
/** Which LOD of each source a `merge` layer takes: `calculate`, the coarsest whose error the
 *  layer's deviation holds at the distance the layer is first seen from; `lowest`, its coarsest. */
export const HLOD_LOD_SELECTIONS = ['calculate', 'lowest'] as const
/** One of `HLOD_LOD_SELECTIONS`. */
type HlodLodSelection = (typeof HLOD_LOD_SELECTIONS)[number]
/** The atlas sides, in texels, a layer may name: a power of two in these bounds. */
export const MIN_HLOD_TEXTURE_SIZE = 16
/** See `MIN_HLOD_TEXTURE_SIZE`. */
export const MAX_HLOD_TEXTURE_SIZE = 8192
/** A layer's atlas side when it names none. */
export const DEFAULT_HLOD_TEXTURE_SIZE = 1024
/** An approximated layer's voxel, in pixels at the distance it is first seen from, when it names
 *  none: 0.65, finer than its one-pixel deviation (`DEFAULT_PIXEL_ERROR`, `lod/policy.ts`), so the
 *  solid it samples holds more detail than the simplification may then remove. */
export const DEFAULT_HLOD_VOXEL_PIXELS = 1.95 / 3
/** The levels a chain may have, HLOD 0 included: each level's grid doubles (`2 << level`). */
export const MIN_HLOD_LEVELS = 2
/** See `MIN_HLOD_LEVELS`. */
export const MAX_HLOD_LEVELS = 8
/** The default chain's levels. */
export const DEFAULT_HLOD_LEVELS = 4
/** A 1×1 opaque white PNG: what a scene decodes in place of an image whose mip chain the cache
 *  bakes — the image an HLOD actor's flattened material names, and what the prepared scene
 *  decodes for an image it skips reading. */
export const BAKED_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP4DwQACfsD/Wj6HMwAAAAASUVORK5CYII='

/** A pattern as the compiler reads it: a string the exact name, `{ regex, flags }` a regular
 *  expression (flags `i`, `m`, `s`). */
export type HlodWirePattern = string | { regex: string; flags?: string }

/** One HLOD layer: its name, its builder, the layer its cells' actors are built by (`parent`;
 *  none at the top of a chain), and its builder's settings, each the automatic rule when left
 *  out. A setting is given in metres or in pixels, not both; a builder refuses another's. */
export interface HlodLayer {
  /** Its name, unique among the layers. */ name: string
  /** How it builds its actors. */ builder: HlodBuilder
  /** The layer its cells' actors are built by; none at the top of a chain. */ parent?: string
  /** An `approximate` or `proxy` layer's voxel, metres. */ accuracy?: number
  /** Its voxel, in pixels at the distance the layer is first seen from.
   *  @defaultValue {@link DEFAULT_HLOD_VOXEL_PIXELS} */
  accuracyPixels?: number
  /** An `approximate` or `merge` layer's geometric deviation, metres: what an approximated shell
   *  is simplified within; a merged layer's LOD of each source, its merged mesh never simplified. */
  deviation?: number
  /** Its deviation, in pixels at the distance the layer is first seen from.
   *  @defaultValue one pixel, `DEFAULT_PIXEL_ERROR` (`lod/policy.ts`) */
  deviationPixels?: number
  /** The atlas side of an `approximate` or `proxy` layer, or of a `merge` layer merging its
   *  materials, texels, a power of two. @defaultValue {@link DEFAULT_HLOD_TEXTURE_SIZE} */
  textureSize?: number
  /** A `merge` layer's LOD of each source (`HLOD_LOD_SELECTIONS`). @defaultValue 'calculate' */
  lodSelection?: HlodLodSelection
  /** Whether a `merge` layer merges its sources' materials into one atlas; otherwise each section
   *  wears its source's material. @defaultValue false */
  mergeMaterials?: boolean
}

/** What a rule matches on what the glTF already carries, each name a pattern `P`: a node's name,
 *  its mesh's name, one of its primitives' material names, and values its `extras` holds — a
 *  pattern for a string, else the exact value. Every field named must match; a rule naming none
 *  is refused. */
export interface HlodMatchOf<P> {
  /** The node's name. */ node?: P
  /** Its mesh's name. */ mesh?: P
  /** One of its primitives' material names. */ material?: P
  /** Values its `extras` must hold. */
  extras?: Record<string, P | number | boolean | null>
}

/** Named layers and the rules assigning objects to them, each name a pattern `P`: an object's
 *  mark first (`HLOD_MARK`), then the first rule that matches, then `default`. An object none
 *  names has no layer: it enters no HLOD actor, streamed and drawn in its cell, nothing standing for it
 *  beyond. Each object follows its layer's chain of parents; two chains build distinct actors in
 *  one cell, one per layer and cell. */
export interface HlodExpertOf<P> {
  /** The layers; each `parent` names the layer its cells' actors are built by. */
  layers: HlodLayer[]
  /** The rules, in order. @defaultValue [] */
  assign?: { match: HlodMatchOf<P>; layer: string }[]
  /** The layer of an object no rule matches. @defaultValue none: such an object has no HLOD */
  default?: string
}

/** A rule's match as the compiler reads it. */
export type HlodWireMatch = HlodMatchOf<HlodWirePattern>
/** The HLOD as the compiler reads it (`resolveHlod` writes it): the expert form, and the layer each
 *  mark names (`marks`) where a mark is not a layer's name — the simple form's groups. A job
 *  naming none builds none. */
export type HlodWire = HlodExpertOf<HlodWirePattern> & { marks?: Record<string, string> }

/** The key of a glTF node's `extras` that marks its object for an HLOD: a group of the simple
 *  form or a layer of the expert form, by name — `"extras": { "hlod": "buildings" }`. A mark wins
 *  over the rules by name; a mark naming no group nor layer refuses the job. */
export const HLOD_MARK = 'hlod'

/** The job field naming the HLOD (`HlodWire`): a batch job's field, the command line's `--hlod=`
 *  flag (`HLOD_OPTION`) holding it as JSON — never a positional field. */
export const HLOD_FIELD = 'hlod'
/** The command line's flag naming the HLOD, its JSON after the `=`. */
export const HLOD_OPTION = '--hlod='

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
/** The level `true`, or nothing, names: the engine's own image. */
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
