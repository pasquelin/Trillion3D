/**
 * A compile job's world partition as a host names it — its scheme and its main grid —, and the
 * functions that turn it into the form the compiler reads (`compiler/args/partition.rs`,
 * `PartitionGrid::read`).
 *
 * `partitionScheme` says how the spatially loaded objects are cut into cells and streamed:
 * `hashSet`, the reference's default — a loose hierarchical grid with no top, each cell streaming
 * by the box of its content, the HLOD grids doubling the main one's cell and range at each level —
 * or `spatialHash`, the older square hierarchical grid over the world, each cell streaming by its
 * square and the objects no cell below its top holds always loaded, each HLOD layer naming its own
 * grid (`cellSize`, `loadingRange`, which `hashSet` ignores). `true` names the default.
 *
 * `partitionGrid` sets the grid every spatially loaded object streams on: its cell side
 * (`cellSize`, metres), its loading range (`loadingRange`, metres), its load priority among the
 * grids (`priority`, the lower the sooner), its origin (`origin`, glTF's `x` and `z`, or under
 * `hashSet` `x`, `y`, `z`) and whether a load waits for its cells near the view
 * (`blockOnSlowStreaming`), each the reference's main grid's when left out — 128 m, 256 m, 0, the
 * origin, false —; and each scheme's own settings (`HASH_SET_GRID_SETTINGS`,
 * `SPATIAL_HASH_GRID_SETTINGS`), each the default of a world the reference creates, which a job of
 * the other scheme may not name. `true` names every default; `false` turns the streaming off —
 * every object loaded with the scene, no cell cut, no HLOD built. A job naming neither compiles at
 * the defaults, its cache key kept. A value left out or `null` names nothing, as the compiler reads
 * it.
 */
import {
  DEFAULT_PARTITION_CELL_SIZE,
  DEFAULT_PARTITION_LOADING_RANGE,
  DEFAULT_PARTITION_PRIORITY,
  MAX_PARTITION_PRIORITY,
  PARTITION_GRID_FIELD,
  PARTITION_GRID_OPTION,
} from './compilerAbi.ts'
import { fieldsOf, refusal } from './nameMatch.ts'

/** The job field naming the world partition's scheme (`resolvePartitionScheme`). A job leaving it
 *  out keeps its cache key. */
export const PARTITION_SCHEME_FIELD = 'partitionScheme'
/** The command line's flag naming the scheme, a bare name after the `=`. */
export const PARTITION_SCHEME_OPTION = '--partition-scheme='
/** The schemes: `hashSet`, the reference's default, a loose hierarchical grid each cell of which
 *  streams by its content; `spatialHash`, the older square grid over the world each cell of which
 *  streams by its square. */
export const PARTITION_SCHEMES = ['hashSet', 'spatialHash'] as const
/** One of `PARTITION_SCHEMES`. */
export type PartitionScheme = (typeof PARTITION_SCHEMES)[number]
/** The scheme of a job that names none, and the one `true` names: the reference's default. */
export const DEFAULT_PARTITION_SCHEME = 'hashSet' satisfies PartitionScheme
/** The scheme a host names: one of `PARTITION_SCHEMES`, or `true` the default one. */
export type PartitionSchemeOption = PartitionScheme | true

/**
 * The scheme the compiler reads for `option`: none when left out.
 * @param option - A scheme of `PARTITION_SCHEMES`, or `true` (the default one).
 * @returns The scheme, `undefined` for none.
 * @throws TypeError naming the schemes when it is none of them — `false` too: `partitionGrid:
 * false` is what turns the streaming off.
 */
export function resolvePartitionScheme(
  option?: PartitionSchemeOption | null,
): PartitionScheme | undefined {
  if (option === undefined || option === null) return undefined
  if (option === true) return DEFAULT_PARTITION_SCHEME
  if (!(PARTITION_SCHEMES as readonly unknown[]).includes(option))
    refusal(PARTITION_SCHEME_FIELD)(
      `must be one of ${PARTITION_SCHEMES.join(', ')} or true, got ${String(option)} ` +
        `(partitionGrid: false turns the streaming off)`,
    )
  return option
}

/** The main grid's settings only the `hashSet` scheme reads: the bounds a cell of its finest
 *  level streams by, whether its grids lie flat on the ground, and each HLOD level's grid. */
export const HASH_SET_GRID_SETTINGS = ['streamBounds', 'flat', 'hlodGrids'] as const
/** The main grid's settings only the `spatialHash` scheme reads: whether each level's cells nest
 *  in the next one's, whether a wished cell pulls in the coarser cells overlapping it, and whether
 *  an object no wider than a finest cell goes to the one under its centre. */
export const SPATIAL_HASH_GRID_SETTINGS = ['nestedLevels', 'pullCoarser', 'smallByCentre'] as const
/** The settings `partitionGrid` may name: every scheme's, then each scheme's own. */
export const PARTITION_GRID_SETTINGS = /* @__PURE__ */ (() =>
  [
    'cellSize',
    'loadingRange',
    'priority',
    'origin',
    'blockOnSlowStreaming',
    ...HASH_SET_GRID_SETTINGS,
    ...SPATIAL_HASH_GRID_SETTINGS,
  ] as const)()
/** The main grid's `blockOnSlowStreaming` when the job says nothing: the reference's, off. */
export const DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING = false
/** The bounds a cell of a loose grid's finest level streams by (`streamBounds`): the box around
 *  its content, its cell's box — of unbounded height on a flat grid —, or the first clipped to the
 *  second. A coarser level's cell streams by its content whatever it says. */
export const PARTITION_STREAM_BOUNDS = ['content', 'cell', 'clipped'] as const
/** One of `PARTITION_STREAM_BOUNDS`. */
export type PartitionStreamBounds = (typeof PARTITION_STREAM_BOUNDS)[number]
/** The main grid's stream bounds when the job names none: the reference's, its content. */
export const DEFAULT_PARTITION_STREAM_BOUNDS = 'content' satisfies PartitionStreamBounds
/** Whether the loose grids lie flat on the ground when the job says nothing: the reference's —
 *  height neither places an object nor keeps a cell out. */
export const DEFAULT_PARTITION_FLAT = true
/** The settings one HLOD level's grid may name (`hlodGrids`), each the main grid's times
 *  `2 << level` when left out, as the reference creates them. */
export const PARTITION_HLOD_GRID_SETTINGS = ['cellSize', 'loadingRange'] as const
/** Whether a square grid's levels nest when the job says nothing: a grid the reference creates
 *  does not — each level but the top one cell wider, its edges off those of the level below. */
export const DEFAULT_PARTITION_NESTED_LEVELS = false
/** Whether a wished cell of a square grid pulls in the coarser cells overlapping it when the job
 *  says nothing: a grid the reference creates does not. */
export const DEFAULT_PARTITION_PULL_COARSER = false
/** Whether an object no wider than a finest cell of a square grid goes to the one under its
 *  centre when the job says nothing: a grid the reference creates does. */
export const DEFAULT_PARTITION_SMALL_BY_CENTRE = true

/** One HLOD level's grid, each setting the main grid's times `2 << level` when left out. */
export type PartitionHlodGrid = {
  /** The side of a cell of its finest level, metres, above 0. */
  cellSize?: number
  /** The distance from the view, metres, above 0, within which its cell loads. */
  loadingRange?: number
}

/** The main grid's settings, each its default when left out. */
export type PartitionGridSettings = {
  /** The side of a cell of the finest level, metres, above 0. @defaultValue 128 */
  cellSize?: number
  /** The distance from the view, metres, above 0, within which a cell loads. @defaultValue 256 */
  loadingRange?: number
  /** The grid's load priority among the grids, a whole number from 0, the lower the sooner.
   *  @defaultValue 0 */
  priority?: number
  /** The grid's origin, glTF's `x` and `z` on the ground, or, under `hashSet`, `x`, `y`, `z` — its
   *  height read by a loose grid that does not lie flat alone —, metres. @defaultValue [0, 0] */
  origin?: readonly [number, number] | readonly [number, number, number]
  /** Whether a load waits for its cells near the view, the session's
   *  `worldStreamingBlockOnSlowStreaming` on; the HLOD grids never do. @defaultValue false */
  blockOnSlowStreaming?: boolean
  /** `hashSet`: the bounds a cell of the finest level streams by (`PARTITION_STREAM_BOUNDS`).
   *  @defaultValue 'content' */
  streamBounds?: PartitionStreamBounds
  /** `hashSet`: whether the grids lie flat on the ground; `false`, they cut height into cells
   *  too and a cell loads while the view comes within its range in 3D. @defaultValue true */
  flat?: boolean
  /** `hashSet`: each HLOD level's grid by level, from 0; a level left out or `null` takes the
   *  main grid's cell and range times `2 << level`. @defaultValue none */
  hlodGrids?: readonly (PartitionHlodGrid | null)[]
  /** `spatialHash`: whether each level's cells nest in the next one's. @defaultValue false */
  nestedLevels?: boolean
  /** `spatialHash`: whether a wished cell pulls in every coarser cell overlapping it, and those
   *  in turn, while the levels do not nest. @defaultValue false */
  pullCoarser?: boolean
  /** `spatialHash`: whether an object whose ground box is no larger than a finest cell goes to the
   *  finest cell under its centre. @defaultValue true */
  smallByCentre?: boolean
}

/** The main grid: `true` every default, `false` the streaming off, or the settings it names. */
export type PartitionGridOption = boolean | PartitionGridSettings

/** The main grid as the compiler reads it: every setting of every scheme named, a scheme's own
 *  only when the job names it; or `false`, the streaming off. */
export type PartitionGridWire =
  | false
  | {
      cellSize: number
      loadingRange: number
      priority: number
      origin: [number, number] | [number, number, number]
      blockOnSlowStreaming?: boolean
      streamBounds?: PartitionStreamBounds
      flat?: boolean
      hlodGrids?: (PartitionHlodGrid | null)[]
      nestedLevels?: boolean
      pullCoarser?: boolean
      smallByCentre?: boolean
    }

/** A finite number above 0. */
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
/** A boolean. */
const boolean = (value: unknown): value is boolean => typeof value === 'boolean'

/**
 * The main grid the compiler reads for `option`: none when left out.
 * @param option - `true` (every default), `false` (the streaming off), or the settings.
 * @returns The compiler's form (`PartitionGridWire`), `undefined` for none.
 * @throws TypeError naming the setting and what it takes when one is wrong, or the allowed forms.
 */
export function resolvePartitionGrid(
  option?: PartitionGridOption | null,
): PartitionGridWire | undefined {
  if (option === undefined || option === null) return undefined
  if (option === false) return false
  const refuse = refusal(PARTITION_GRID_FIELD)
  if (option !== true && (typeof option !== 'object' || Array.isArray(option)))
    refuse(
      `must be true, false or an object of ${PARTITION_GRID_SETTINGS.join(', ')}, got ${String(option)}`,
    )
  const named: Record<string, unknown> =
    option === true ? {} : fieldsOf(option, PARTITION_GRID_SETTINGS, 'the grid', refuse)
  const read = <T>(name: string, fits: (value: unknown) => boolean, fallback: T, takes: string) => {
    const value = named[name]
    if (value === undefined || value === null) return fallback
    if (!fits(value)) refuse(`${name} must be ${takes}, got ${JSON.stringify(value)}`)
    return value as T
  }
  const whole = (value: unknown) =>
    Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_PARTITION_PRIORITY
  const point = (value: unknown) =>
    Array.isArray(value) &&
    (value.length === 2 || value.length === 3) &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v))
  const level = (value: unknown, at: number) => {
    if (value === null) return null
    const fields = fieldsOf(value, PARTITION_HLOD_GRID_SETTINGS, `hlodGrids[${at}]`, refuse)
    for (const name of PARTITION_HLOD_GRID_SETTINGS)
      if (fields[name] != null && !positive(fields[name]))
        refuse(`hlodGrids[${at}].${name} must be a number of metres above 0`)
    return fields as PartitionHlodGrid
  }
  const wire: Exclude<PartitionGridWire, false> = {
    cellSize: read('cellSize', positive, DEFAULT_PARTITION_CELL_SIZE, 'a number of metres above 0'),
    loadingRange: read(
      'loadingRange',
      positive,
      DEFAULT_PARTITION_LOADING_RANGE,
      'a number of metres above 0',
    ),
    priority: read(
      'priority',
      whole,
      DEFAULT_PARTITION_PRIORITY,
      `a whole number from 0 to ${MAX_PARTITION_PRIORITY}`,
    ),
    origin: [...read<readonly number[]>('origin', point, [0, 0], 'two or three finite numbers')] as
      [number, number] | [number, number, number],
  }
  // A scheme's own settings are written only where named: the compiler refuses one the job's
  // scheme does not read.
  const bounds = (value: unknown) => (PARTITION_STREAM_BOUNDS as readonly unknown[]).includes(value)
  const streamBounds = read<PartitionStreamBounds | undefined>(
    'streamBounds',
    bounds,
    undefined,
    `one of ${PARTITION_STREAM_BOUNDS.join(', ')}`,
  )
  if (streamBounds) wire.streamBounds = streamBounds
  const levels = read<unknown[] | undefined>('hlodGrids', Array.isArray, undefined, 'an array')
  if (levels) wire.hlodGrids = levels.map(level)
  // The settings that are true or false, written only where the job names them.
  for (const name of ['blockOnSlowStreaming', 'flat', ...SPATIAL_HASH_GRID_SETTINGS] as const) {
    const named = read<boolean | undefined>(name, boolean, undefined, 'true or false')
    if (named !== undefined) wire[name] = named
  }
  return wire
}

/** A job's partition options as a host names them. */
export type PartitionJobOptions = {
  partitionScheme?: PartitionSchemeOption | null
  partitionGrid?: PartitionGridOption | null
}

/** A job's `partitionScheme` and `partitionGrid` fields as the compiler reads them, each left out
 *  when the job names none.
 *  @throws TypeError when the grid names a setting the job's scheme does not read. */
export function partitionJobFields({ partitionScheme, partitionGrid }: PartitionJobOptions) {
  const out: { partitionScheme?: PartitionScheme; partitionGrid?: PartitionGridWire } = {}
  const scheme = resolvePartitionScheme(partitionScheme)
  const grid = resolvePartitionGrid(partitionGrid)
  const loose = (scheme ?? DEFAULT_PARTITION_SCHEME) === 'hashSet'
  const foreign = loose ? SPATIAL_HASH_GRID_SETTINGS : HASH_SET_GRID_SETTINGS
  const named = grid && foreign.find((name) => grid[name] !== undefined)
  if (named)
    refusal(PARTITION_GRID_FIELD)(
      `${named} is read by partitionScheme ${loose ? 'spatialHash' : 'hashSet'} alone`,
    )
  // A square grid lies on the ground: its origin has no height.
  if (grid && !loose && grid.origin.length !== 2)
    refusal(PARTITION_GRID_FIELD)(
      `origin must be two finite numbers, got ${JSON.stringify(grid.origin)}`,
    )
  if (scheme) out.partitionScheme = scheme
  if (grid !== undefined) out.partitionGrid = grid
  return out
}

/** A job's partition options as the command line's flags, none for an option the job leaves
 *  out. */
export function partitionFlags(options: PartitionJobOptions): string[] {
  const { partitionScheme, partitionGrid } = partitionJobFields(options)
  return [
    ...(partitionScheme ? [`${PARTITION_SCHEME_OPTION}${partitionScheme}`] : []),
    ...(partitionGrid === undefined
      ? []
      : [`${PARTITION_GRID_OPTION}${JSON.stringify(partitionGrid)}`]),
  ]
}
