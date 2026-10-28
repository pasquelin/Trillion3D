/**
 * A compile job's streaming grids as a host names them — the one `partitionGrid`, or the list
 * `partitionGrids` —, and the functions that turn them into the form the compiler reads
 * (`compiler/args/partition.rs`, `PartitionGrid::read`). What each names, and the scheme's
 * settings a grid may hold, is told in `partitionOptions.ts`.
 */
import {
  DEFAULT_PARTITION_GRID_NAME,
  PARTITION_GRID_FIELD,
  PARTITION_GRID_NAME_FORBIDDEN,
  PARTITION_GRID_NAME_KEY,
  PARTITION_GRIDS_FIELD,
} from './compilerAbi.ts'
import { isFiniteNumber } from '../../../math/src/scalar/reals.ts'
import { fieldsOf, refusal, type Refuse } from './nameMatch.ts'
import { namedSetting, settingFits, settingTakes } from './settingRules.ts'
import {
  GRID_RULES,
  PARTITION_GRID_SETTINGS,
  PARTITION_HLOD_GRID_SETTINGS,
  SPATIAL_HASH_GRID_SETTINGS,
  type PartitionStreamBounds,
} from './partitionGridRules.ts'

export * from './partitionGridRules.ts'

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
  /** `hashSet`: the names of the HLOD layers (`hlod.layers`) that have grids on this main grid.
   *  The actors of another layer are built all the same, always loaded, as those of a layer not
   *  spatially loaded. @defaultValue every layer of the job's HLOD */
  hlodLayers?: readonly string[]
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
  hlodLayers?: string[]
  nestedLevels?: boolean
  pullCoarser?: boolean
  smallByCentre?: boolean
}

/** The main grid as the compiler reads it, or `false`, the streaming off. */
export type PartitionGridWire = false | PartitionGridSettingsWire

/** Whether `value` is a point of two or three finite numbers. */
const isPoint = (value: unknown) =>
  Array.isArray(value) && [2, 3].includes(value.length) && value.every(isFiniteNumber)

/** The grid of HLOD level `at` the job names, `null` for a level that streams none, refused by
 *  `refuse` when it holds a setting its rule does not take. */
function readLevel(value: unknown, at: number, refuse: Refuse) {
  if (value === null) return null
  const fields = fieldsOf(value, PARTITION_HLOD_GRID_SETTINGS, `hlodGrids[${at}]`, refuse)
  for (const name of PARTITION_HLOD_GRID_SETTINGS)
    if (fields[name] != null && !settingFits(GRID_RULES[name], fields[name]))
      refuse(`hlodGrids[${at}].${name} must be ${settingTakes(GRID_RULES[name])}`)
  return fields as PartitionHlodGrid
}

/** Whether `value` is a list of layer names, each a text that is not empty. */
const isLayerNames = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((name) => typeof name === 'string' && name !== '')

/** The grid `option` names, read from the job field `field`, which a refusal names. */
function readGrid(
  option: PartitionGridOption | null | undefined,
  field: string,
): PartitionGridWire | undefined {
  if (option == null) return undefined
  if (option === false) return false
  const refuse: Refuse = refusal(field)
  if (option !== true && (typeof option !== 'object' || Array.isArray(option)))
    refuse(
      `must be true, false or an object of ${PARTITION_GRID_SETTINGS.join(', ')}, got ${String(option)}`,
    )
  const named: Record<string, unknown> =
    option === true ? {} : fieldsOf(option, PARTITION_GRID_SETTINGS, 'the grid', refuse)
  /** The value the job names of the setting `name`, `undefined` for none; refused when the rule
   *  does not take it. */
  const read = <K extends keyof typeof GRID_RULES>(name: K) => {
    return namedSetting(GRID_RULES[name], named[name], name, refuse) as
      (typeof GRID_RULES)[K]['default'] | undefined
  }
  /** The setting `name` as the job names it, else its rule's default. */
  const readOr = (name: 'cellSize' | 'loadingRange' | 'priority') =>
    read(name) ?? GRID_RULES[name].default
  const origin = (named.origin ?? [0, 0]) as number[]
  if (!isPoint(origin))
    refuse(`origin must be two or three finite numbers, got ${JSON.stringify(origin)}`)
  const wire: PartitionGridSettingsWire = {
    cellSize: readOr('cellSize'),
    loadingRange: readOr('loadingRange'),
    priority: readOr('priority'),
    origin: [...origin] as [number, number] | [number, number, number],
  }
  // A scheme's own settings are written only where named: the compiler refuses one the job's
  // scheme does not read.
  const streamBounds = read('streamBounds')
  if (streamBounds) wire.streamBounds = streamBounds
  const levels = named.hlodGrids
  if (levels != null) {
    if (!Array.isArray(levels)) refuse(`hlodGrids must be an array, got ${JSON.stringify(levels)}`)
    wire.hlodGrids = levels.map((level, at) => readLevel(level, at, refuse))
  }
  const layers = named.hlodLayers
  if (layers != null) {
    if (!isLayerNames(layers))
      refuse(`hlodLayers must be an array of layer names, got ${JSON.stringify(layers)}`)
    wire.hlodLayers = [...layers]
  }
  // The settings that are true or false, written only where the job names them.
  for (const name of ['blockOnSlowStreaming', 'flat', ...SPATIAL_HASH_GRID_SETTINGS] as const) {
    const value = read(name)
    if (value !== undefined) wire[name] = value
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
      // The square settings are the whole partition's: a later grid names them alike or not at all.
      const first = at > 0 ? (wires[0][setting] ?? GRID_RULES[setting].default) : grid[setting]
      if (grid[setting] !== undefined && grid[setting] !== first)
        refuse(`${setting} is the whole partition's, the first grid's: name it alike or not at all`)
    }
    wires.push(isGridName(name) ? { name, ...grid } : grid)
  }
  return wires
}
