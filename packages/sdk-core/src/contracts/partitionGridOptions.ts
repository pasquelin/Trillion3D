/**
 * A compile job's streaming grids as a host names them — the one `partitionGrid`, or the list
 * `partitionGrids` —, and the functions that turn them into the form the compiler reads
 * (`compiler/args/partition.rs`, `PartitionGrid::read`). What each names, and the scheme's
 * settings a grid may hold, is told in `partitionOptions.ts`.
 */
import {
  DEFAULT_PARTITION_CELL_SIZE,
  DEFAULT_PARTITION_GRID_NAME,
  DEFAULT_PARTITION_LOADING_RANGE,
  DEFAULT_PARTITION_PRIORITY,
  MAX_PARTITION_PRIORITY,
  PARTITION_GRID_FIELD,
  PARTITION_GRID_NAME_FORBIDDEN,
  PARTITION_GRID_NAME_KEY,
  PARTITION_GRIDS_FIELD,
} from './compilerAbi.ts'
import { isFiniteNumber } from '../../../math/src/scalar/reals.ts'
import { fieldsOf, refusal } from './nameMatch.ts'

/** The main grid's settings only the `hashSet` scheme reads: the bounds a cell of its finest
 *  level streams by, whether it lies flat on the ground, and each HLOD level's grid. */
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
/** Whether a loose grid lies flat on the ground when the job says nothing: the reference's —
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
  /** `hashSet`: whether the grid lies flat on the ground, with its HLOD grids; `false`, they cut
   *  height into cells too and a cell loads while the view comes within its range in 3D.
   *  @defaultValue true */
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

/** A grid as the compiler reads it: every setting of every scheme named, a scheme's own only when
 *  the job names it. */
export type PartitionGridSettingsWire = {
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

/** The main grid as the compiler reads it, or `false`, the streaming off. */
export type PartitionGridWire = false | PartitionGridSettingsWire

/** A finite number above 0. */
const positive = (value: unknown): value is number => isFiniteNumber(value) && value > 0
/** A boolean. */
const boolean = (value: unknown): value is boolean => typeof value === 'boolean'

/** The grid `option` names, read from the job field `field`, which a refusal names. */
function readGrid(
  option: PartitionGridOption | null | undefined,
  field: string,
): PartitionGridWire | undefined {
  if (option === undefined || option === null) return undefined
  if (option === false) return false
  const refuse = refusal(field)
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
    value.every(isFiniteNumber)
  const level = (value: unknown, at: number) => {
    if (value === null) return null
    const fields = fieldsOf(value, PARTITION_HLOD_GRID_SETTINGS, `hlodGrids[${at}]`, refuse)
    for (const name of PARTITION_HLOD_GRID_SETTINGS)
      if (fields[name] != null && !positive(fields[name]))
        refuse(`hlodGrids[${at}].${name} must be a number of metres above 0`)
    return fields as PartitionHlodGrid
  }
  const wire: PartitionGridSettingsWire = {
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

/**
 * The main grid the compiler reads for `option`: none when left out.
 * @param option - `true` (every default), `false` (the streaming off), or the settings.
 * @returns The compiler's form (`PartitionGridWire`), `undefined` for none.
 * @throws TypeError naming the setting and what it takes when one is wrong, or the allowed forms.
 */
export const resolvePartitionGrid = (
  option?: PartitionGridOption | null,
): PartitionGridWire | undefined => readGrid(option, PARTITION_GRID_FIELD)

/** One grid of `partitionGrids`: its name — left out, the first grid's is the default's — and the
 *  settings `partitionGrid` takes. */
export type PartitionGridEntry = PartitionGridSettings & { name?: string }

/** The streaming grids: one or more entries, the first the default grid. */
export type PartitionGridsOption = readonly PartitionGridEntry[]

/** The streaming grids as the compiler reads them: each entry's grid as `partitionGrid` is read,
 *  under its name. */
export type PartitionGridsWire = (PartitionGridSettingsWire & { name?: string })[]

/** Whether `value` can name a grid: a text, not empty, holding none of
 *  `PARTITION_GRID_NAME_FORBIDDEN`. */
export const isGridName = (value: unknown): value is string =>
  typeof value === 'string' &&
  value !== '' &&
  ![...value].some((char) => PARTITION_GRID_NAME_FORBIDDEN.includes(char))

/** The square settings of the whole partition, which a grid names alike or not at all, by what a
 *  grid that names none takes. */
const SQUARE_DEFAULTS = {
  nestedLevels: DEFAULT_PARTITION_NESTED_LEVELS,
  pullCoarser: DEFAULT_PARTITION_PULL_COARSER,
  smallByCentre: DEFAULT_PARTITION_SMALL_BY_CENTRE,
}

/**
 * The streaming grids the compiler reads for `option`: none when left out.
 * @param option - One or more grids, each the settings of `partitionGrid` under a `name`, the
 * first the default grid, whose name may be left out (the reference's, `MainPartition`).
 * @returns The compiler's form (`PartitionGridsWire`), `undefined` for none.
 * @throws TypeError naming the entry and what it takes when one is wrong: a name missing, no grid
 * name (`isGridName`) or one another grid has (names are told apart without regard to case, as
 * the reference's are); a setting the grid does not take; a square setting — the whole
 * partition's — that a later grid names unlike the first's.
 */
export function resolvePartitionGrids(
  option?: PartitionGridsOption | null,
): PartitionGridsWire | undefined {
  if (option === undefined || option === null) return undefined
  if (!Array.isArray(option) || option.length === 0)
    refusal(PARTITION_GRIDS_FIELD)(
      `must be a list of one grid or more, each an object of ${PARTITION_GRID_NAME_KEY}, ` +
        `${PARTITION_GRID_SETTINGS.join(', ')}, got ${JSON.stringify(option)}`,
    )
  const told = new Set<string>()
  const wires: PartitionGridsWire = []
  const accepted = [PARTITION_GRID_NAME_KEY, ...PARTITION_GRID_SETTINGS]
  for (const [at, entry] of (option as readonly unknown[]).entries()) {
    const field = `${PARTITION_GRIDS_FIELD}[${at}]`
    const refuse = refusal(field)
    const fields = fieldsOf(entry, accepted, 'the grid', refuse)
    const { [PARTITION_GRID_NAME_KEY]: name, ...settings } = fields
    const named = name !== undefined && name !== null
    if (!named && at > 0)
      refuse(`${PARTITION_GRID_NAME_KEY} is required: only the first grid may leave it out`)
    if (named && !isGridName(name))
      refuse(
        `${PARTITION_GRID_NAME_KEY} must be a text with none of ${PARTITION_GRID_NAME_FORBIDDEN}, ` +
          `got ${JSON.stringify(name)}`,
      )
    const key = String(name ?? DEFAULT_PARTITION_GRID_NAME).toLowerCase()
    if (told.has(key))
      refuse(`${PARTITION_GRID_NAME_KEY} ${JSON.stringify(name)} names a grid already`)
    told.add(key)
    const grid = readGrid(settings as PartitionGridSettings, field) as PartitionGridSettingsWire
    for (const setting of SPATIAL_HASH_GRID_SETTINGS) {
      const first = at > 0 ? (wires[0][setting] ?? SQUARE_DEFAULTS[setting]) : grid[setting]
      if (grid[setting] !== undefined && grid[setting] !== first)
        refuse(`${setting} is the whole partition's, the first grid's: name it alike or not at all`)
    }
    wires.push(isGridName(name) ? { name, ...grid } : grid)
  }
  return wires
}
