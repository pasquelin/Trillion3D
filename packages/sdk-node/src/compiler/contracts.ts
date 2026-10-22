import type { AssetScope, PreparationProgress } from '../../../sdk-core/src/contracts/base.ts'
import type { Simplification } from '../../../sdk-core/src/contracts/compilerAbi.ts'
import type { HlodOptions } from '../../../sdk-core/src/contracts/hlodOptions.ts'
import type {
  MaterialsOption,
  ResponsiveOption,
  TemporalAntialiasingOption,
} from '../../../sdk-core/src/contracts/materialOptions.ts'
import type { VoxelizeOption } from '../../../sdk-core/src/contracts/voxelizeOptions.ts'
import type {
  PartitionGridOption,
  PartitionGridsOption,
  PartitionSchemeOption,
} from '../../../sdk-core/src/contracts/partitionOptions.ts'
import type { MeshBuildOption } from '../../../sdk-core/src/contracts/meshBuildOptions.ts'
import type { ObjectSettingsOption } from '../../../sdk-core/src/contracts/objectOptions.ts'
import type { DagWarning } from '../../../sdk-core/src/contracts/dag.ts'
import type { JobSnapshot } from '../../../sdk-core/src/runtime/jobs/jobs.ts'

/** One JSON event from the native compiler's stderr. */
export interface CompilerEvent {
  /** What happened: `progress`, `phase`, `done`… */ event: string
  /** The job the event belongs to. */ job: string
  /** Share of the work done, 0 to 1. */ ratio?: number
  /** The step the compiler is in. */ phase?: string
  /** How the job ended. */ status?: string
  /** An error's stable name. */ code?: string
  /** Words for a person to read. */ message?: string
  /** The file the event is about. */ file?: string
  /** The sub-step inside the phase. */ step?: string
  /** Units of work done. */ completed?: number
  /** Units of work in all. */ total?: number
  /** Bytes written or read. */ bytes?: number
  /** Primitives handled. */ primitives?: number
  /** Cache entries the prune removed. */ removedKeys?: number
  /** Bytes the prune freed. */ removedBytes?: number
  /** Jobs in the batch. */ jobs?: number
  /** The finished pointer, on the last event. */ pointer?: ProgressPointer
  /** The mesh the event is about. */ mesh?: number
  /** The primitive the event is about. */ primitive?: number
  /** DAG warnings of a primitive, carried by its `primitive` event. */
  warnings?: DagWarning[]
  [key: string]: unknown
}

/** What a finished job's pointer says, as progress shows it. */ export interface ProgressPointer {
  /** Triangles kept. */ selectedTriangles?: number
  /** Primitives compiled. */ primitives?: number
  /** How long it took. */ metrics?: { wallMs?: number }
}

/** Where progress is written. */ export interface ProgressStream {
  /** Whether it is a live terminal. */ isTTY?: boolean
  /** Terminal width, in characters. */ columns?: number
  /** Writes text out. */ write(text: string): unknown
}

/** A terminal progress display. */ export interface TerminalProgress {
  /** Shows one event. */ event(event: CompilerEvent): void
  /** Prints a note. */ note(text: string): void
  /** Prints a failure. */ fail(message: string): void
  /** Warning-level messages counted so far: what `--strict` refuses. */ readonly warnings: number
}

/** How a terminal progress display looks. */ export interface TerminalProgressOptions {
  /** The job's name. */ label?: string
  /** The job's number. */ index?: number
  /** How many jobs in all. */ total?: number
  /** Where to write. */ stream?: ProgressStream
  /** Bar width. */ width?: number
  /** Least milliseconds between redraws. */ interval?: number
  /** Also tell the info codes and every occurrence in the end-of-job summary. */ verbose?: boolean
}

/** How `prepare` compiles a model. */ export interface PrepareOptions {
  /** The address the model's files load from. */ resourceBaseUrl: string
  /** The compiler program to run. */ executable?: string
  /** Threads the compiler may use; every core of the machine when omitted. */ threads?: number
  /** Memory the compiler may use, in MB. @defaultValue 4096 */ ramBudgetMb?: number
  /** How meshes are simplified. @defaultValue 'qem-endpoints' */ simplification?: Simplification
  /** The world's HLOD: the simple form (`levels`, `groups`, `default`) or the expert form (`layers`, `assign`, `default`), over the objects a node's
   *  `extras.hlod` mark or a group or rule names. @defaultValue none: the job builds no HLOD */
  hlod?: HlodOptions
  /** The scene's temporal anti-aliasing level, written in its manifest — `'off'`, `'low'`,
   *  `'medium'`, `'high'`, `'max'`, `true` the default level, `false` off —: the runtime's
   *  `'scene'` setting, below the quality, the page and the editor; the first loaded scene naming
   *  it decides (`resolveTemporalAntialiasing`). @defaultValue none: the runtime's own, `'max'` */
  temporalAntialiasing?: TemporalAntialiasingOption
  /** The objects whose materials keep a responsive temporal history: a node's name, a pattern on
   *  it, or a match (`resolveResponsive`). @defaultValue none */
  responsive?: ResponsiveOption
  /** Settings by material name — `{ name: { temporalAntialiasing, responsive } }`, the history
   *  share a name of `'normal'`, `'responsive'`, `'soft'`, `'off'` or a number in [0, 1] —,
   *  winning over `responsive` and the material's own `extras` (`resolveMaterials`).
   *  @defaultValue none */
  materials?: MaterialsOption
  /** The objects whose meshes are voxelized far away — their coarse levels bricks of voxels, a
   *  leaf's cut-out kept —: a node's name, a pattern on it, or a match (`resolveVoxelize`); the
   *  HLOD `foliage` group's objects are without it. @defaultValue none */
  voxelize?: VoxelizeOption
  /** How the spatially loaded objects are cut into cells and streamed: `'hashSet'`, the
   *  reference's default — a loose hierarchical grid with no top, each cell loading while the view
   *  comes within its grid's range of the box around its content, the cells of a higher level
   *  first, each HLOD level `i` on a grid of `(2 << i)` times the main grid's cell and range —, or
   *  `'spatialHash'` — the older square grid over the world, each cell loading by its square, an
   *  object no cell below the top holds always loaded, each HLOD layer on the grid its `cellSize`
   *  and `loadingRange` name; `true` the default (`resolvePartitionScheme`). @defaultValue none:
   *  `'hashSet'`, the cache key unchanged */
  partitionScheme?: PartitionSchemeOption
  /** The partition's main grid, every spatially loaded object streaming on it: `{ cellSize,
   *  loadingRange, priority, origin, blockOnSlowStreaming }` — its cell side and loading range in
   *  metres, its load priority among the grids, the lower the sooner, its origin (glTF `x`, `z`,
   *  or under `hashSet` `x`, `y`, `z`), whether a load waits for its cells near the view while the
   *  session's `worldStreamingBlockOnSlowStreaming` is on —, and each scheme's own settings — under
   *  `hashSet` `{ streamBounds, flat, hlodGrids }`, under `spatialHash` `{ nestedLevels,
   *  pullCoarser, smallByCentre }`, the other scheme's refused —, each the reference's when left
   *  out (128 m, 256 m, 0, the origin, `false`, `'content'`, `true`, `2 << level` the main grid's,
   *  `false`, `false`, `true`); `true` every
   *  default, `false` the streaming off: every object loaded with the scene, no HLOD built
   *  (`resolvePartitionGrid`). @defaultValue none: the reference's main grid, the cache key
   *  unchanged */
  partitionGrid?: PartitionGridOption
  /** Several streaming grids instead of the one `partitionGrid`, each under a `name`, the first
   *  the default; an object picks its grid by `runtimeGrid` (`resolvePartitionGrids`).
   *  @defaultValue none: the one reference main grid, the cache key unchanged */
  partitionGrids?: PartitionGridsOption
  /** How each mesh is built: `{ storedTangents, keptTriangles, trimmedError, dropNearCollapsed,
   *  alwaysResidentKib, recomputeNormals, recomputeTangents, useMikkTSpace,
   *  computeWeightedNormals, skinnedWeldPosition, skinnedWeldNormal, skinnedWeldTexture,
   *  voxelRays, voxelLevel, voxelBackUp, voxelSeparable, voxelNdf, voxelOpacity, allowAssemblies,
   *  positionPrecision, normalPrecision, tangentPrecision, objects }`
   *  — whether its pages store the build's tangents (default `false`), the share of its triangles
   *  (default 1) and the error in percent of its size (default 0) its finest level is cut to,
   *  whether a triangle two of whose corners lie within 200 nanometres is dropped (default
   *  `true`), how many KiB of it stay resident whatever the view, its root pages of 32 KiB holding
   *  at least that much (default 0, one root page), whether the build rebuilds every normal
   *  (default `true`) and every stored tangent (default `true`), the tangents MikkTSpace's
   *  (default `true`), the normals weighed by area and angle (default `false`), and how far a
   *  skinned mesh's corners may differ and be welded — metres (default 2e-7), unit vectors
   *  (default 2e-5), texture coordinates (default 1/1024) —, how a voxelized mesh's voxels are
   *  sampled: the rays cast across each (default 64), the DAG level from which every group is
   *  voxels (default 0: where they are finer than its triangles), how far back a ray starts, in
   *  voxel sides (default 0), whether the rays run along the axes alone (default `false`), whether
   *  a voxel keeps its normals' spread (default `true`) and its coverage as opacity (default
   *  `false`), whether the assembly its glTF `extras.assembly` names — parts and nodes — is built,
   *  its own triangles and every node's part carried by its transform (default `false`: its own
   *  triangles alone), the position grid of its pages (cells
   *  of 2^-n centimetre, a whole number from -20 to 43; default none: the mesh's density sets it),
   *  the bits an axis of its normals (1 to 15, default 8) and of its stored tangents' angle (0 to
   *  12, default 7), `objects`
   *  the rules `{ match, …settings }` setting them for the meshes
   *  of the objects a match names; for each setting, the first rule matching, the scene's, the
   *  mesh's own `extras`, the default (`resolveMeshBuild`). @defaultValue none: every default,
   *  the cache key unchanged */
  meshBuild?: MeshBuildOption
  /** Each object's settings: `{ spatiallyLoaded, skinnedInstance, drawDistance, runtimeGrid, objects }` —
   *  whether it streams on the partition's main grid, drawn while the view lies within the grid's
   *  loading range of its cell (default `true`: an animated object streams too, no HLOD standing
   *  for it past its cell's range), or is loaded with the scene and always drawn (`false`);
   *  whether a skinned object plays a clip baked into the scene's animation banks on the GPU,
   *  every instance of one clip, mesh and settings in one pose — `true` every default, `false`
   *  (the default) its host's clips move it, or `{ clip, looping, playRate, position, boundsScale,
   *  animationMinScreenSize, mobility }`, each its default when left out: the first animation
   *  moving a joint of its skin, `true`, 1, 0, 1, 0 the run-time setting
   *  `animationMinScreenSize`, `'movable'` —; the distances from the eye to the centre of its
   *  bounds, in the scene's units, it is drawn at, culled nearer than `min` and farther than `max`
   *  unless `max` is 0 (`cutDrawDistanceCulling`): `false` (the default) none, or `{ min, max }`,
   *  each 0 when left out —; `runtimeGrid`, the name of the streaming grid it streams on
   *  (`partitionGrids`; the first when it names none or one the job does not hold); `objects` the
   *  rules `{ match, …settings }` setting them for the objects a match names; for each setting,
   *  the first rule matching, the scene's, the node's own `extras`, the default
   *  (`resolveObjectSettings`). @defaultValue none: every default, the cache key unchanged */
  objectSettings?: ObjectSettingsOption
  /** Stops the job when aborted. */ signal?: AbortSignal
  /** Called on each event. */
  onProgress?: (event: CompilerEvent & Partial<PreparationProgress>) => void
}

/** What a finished compilation reports. */ export interface CompilationSummary {
  /** Always `'ready'`. */ status: 'ready'
  /** The cache key. */ key: string
  /** Full or streamed. */ scope: AssetScope
  /** Where a page loads it. */ url: string
  /** The pointer file. */ pointer: string
  /** The cache folder. */ cache: string
  /** The compiler's version. */ compilerVersion: string
  /** Triangles kept. */ selectedTriangles: number
  /** Triangles in the source. */ sourceTriangles?: number | null
  /** Nodes in the hierarchy. */ totalNodes?: number | null
  /** Whether meshes were simplified. */ simplification?: boolean
  /** What the compiler could not do. */ unsupported?: unknown
}

/** What a job proved before keeping an existing folder instead of writing it (`null` when it compiled; `clusterHierarchyPagesMs` is then `null` too). */
export interface ReusedFolder {
  /** Files checked. */ files: number
  /** Bytes of those files. */ fileBytes: number
  /** Cache objects checked. */ objects: number
  /** Bytes of those objects. */ objectBytes: number
  /** Texture levels checked. */ textureLevels: number
  /** Time the check took. */ validateMs: number
}

/** The pointer file of a compiled model. */
export interface CompilationPointer extends CompilationSummary {
  /** The cache format. */ formatVersion: number
  /** Nodes kept. */ selectedNodes: number
  /** Primitives kept. */ primitives: number
  /** Time and size. */ metrics: {
    importMs: number
    clusterHierarchyPagesMs: number | null
    [measure: string]: unknown // compileMs, phaseElapsedMs, peakRssBytes… on a compiled folder
    wallMs: number
    pruneMs: number
    outputGeometryBytes: number
    threads: number
    ramBudgetMb: number
  }
  /** Pages the run found already built (`null` on a kept folder). */ reusedPages: number | null
  /** What was reused. */ reused: ReusedFolder | null
}

/** What `prepare` returns. */ export interface CompilationResult extends CompilationSummary {
  /** Cache format. */ formatVersion: number
  /** Nodes kept. */ selectedNodes: number
  /** Primitives. */ primitives: unknown[]
  /** Reuse proof. */ reused?: ReusedFolder | null
  [key: string]: unknown
}

/** One model in a batch: the fields of one compile job (`JOB_FIELDS`), named as a single job names
 *  them; its scope defaults to `'full'`. */
export interface BatchJob extends Pick<
  CompilationJobOptions,
  | 'resourceBaseUrl'
  | 'scope'
  | 'triangleBudget'
  | 'threads'
  | 'ramBudgetMb'
  | 'simplification'
  | 'hlod'
  | 'temporalAntialiasing'
  | 'responsive'
  | 'materials'
  | 'voxelize'
  | 'partitionScheme'
  | 'partitionGrid'
  | 'partitionGrids'
  | 'meshBuild'
  | 'objectSettings'
> {
  /** Its name. */ id?: string
  /** The source file. */ source: string
  /** The cache folder. */ cache: string
}

/** How a batch runs. */ export interface BatchOptions {
  /** Jobs at once. */ workers?: number
  /** Memory for all jobs, in MB. */ ramBudgetMb?: number
  /** Threads per job. */ threads?: number
  /** The compiler program. */ executable?: string
  /** Stops the batch when aborted. */ signal?: AbortSignal
  /** Called on each event. */ onEvent?: (event: CompilerEvent) => void
}

/** How one batch job ended. */ export interface BatchOutcome {
  /** The job's name. */ job: string
  /** Done or failed. */ status: 'ready' | 'error'
  /** The pointer, when done. */ pointer?: CompilationPointer
  /** The error's name. */ code?: string
  /** The error's words. */ message?: string
}

/** How a whole batch ended. */ export interface BatchSummary {
  /** All, some or none done. */ status: 'ready' | 'partial' | 'failed'
  /** Jobs done. */ completed: number
  /** Jobs failed. */ failed: number
  /** Jobs cancelled. */ cancelled: number
  /** Each job's outcome. */ jobs: BatchOutcome[]
}

/** A compilation running. */ export interface CompilationJob {
  /** Settles when done. */ promise: Promise<CompilationResult>
  /** Stops it. */ cancel(reason?: unknown): void
  /** Its state now. */ getSnapshot(): JobSnapshot<CompilationResult>
  /** Hears each change. */ subscribe(listener: () => void): () => void
}

/** How a compilation job runs. */ export interface CompilationJobOptions extends PrepareOptions {
  /** Full or streamed. */ scope?: AssetScope
  /** Triangle budget. */ triangleBudget?: number
  /** Hears each state. */ telemetry?: (snapshot: JobSnapshot<CompilationResult>) => void
}

/** A model already compiled, as the cutout review reads it: its product, its source, its scope.
 *  Not a `BatchJob`: the review submits nothing and needs no triangle budget to ask a question. */
export interface CutoutModel {
  /** Its name. */ id?: string
  /** The cache folder. */ cache: string
  /** The source file. */ source: string
  /** Full or streamed. */ scope?: AssetScope
}

/** How the cut-out review asks. */ export interface CutoutReviewOptions {
  /** Where to write. */ stream?: ProgressStream
  /** Where answers come from. */ input?: NodeJS.ReadStream
  /** Defaults to whether the stream is a terminal. */ interactive?: boolean
}

/**
 * What the pass did. `changed` names the models an answer moved: compiling them again is the
 * caller's to do, with its own budget, its own progress and its own cancellation — the review has
 * none of those and has no business guessing them.
 */
export interface CutoutReviewSummary {
  /** Questions left. */ pending: number
  /** Questions answered. */ answered: number
  /** Models to compile again. */ changed: CutoutModel[]
}
