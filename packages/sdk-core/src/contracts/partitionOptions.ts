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
 *
 * `partitionGrids` names several grids instead, a list of the settings `partitionGrid` takes, each
 * under a `name`, the first the default grid: each has its own cells, its own loading range and
 * its own chain of HLOD grids, an object streaming on the one its `runtimeGrid` setting names
 * (`objectOptions.ts`) — the first when it names none, or one the list does not hold. A job names
 * `partitionGrid` or `partitionGrids`, not both. Each grid lies flat or not for itself (`flat`).
 */
import {
  PARTITION_GRID_FIELD,
  PARTITION_GRID_OPTION,
  PARTITION_GRIDS_FIELD,
  PARTITION_GRIDS_OPTION,
} from './compilerAbi.ts'
import { refusal } from './nameMatch.ts'
import {
  HASH_SET_GRID_SETTINGS,
  resolvePartitionGrid,
  resolvePartitionGrids,
  SPATIAL_HASH_GRID_SETTINGS,
  type PartitionGridOption,
  type PartitionGridSettingsWire,
  type PartitionGridsOption,
  type PartitionGridsWire,
  type PartitionGridWire,
} from './partitionGridOptions.ts'

export * from './partitionGridOptions.ts'

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

/**
 * Whether the grid `grid`, read from `field`, names only what a job of the `hashSet` scheme
 * (`loose`) or of the `spatialHash` one reads: a setting of the other scheme refuses it, and a
 * square grid lies on the ground, its origin without a height.
 * @throws TypeError naming the setting when the scheme does not read it.
 */
function assertGridFitsScheme(grid: PartitionGridSettingsWire, loose: boolean, field: string) {
  const foreign = loose ? SPATIAL_HASH_GRID_SETTINGS : HASH_SET_GRID_SETTINGS
  const named = foreign.find((name) => grid[name] !== undefined)
  if (named)
    refusal(field)(`${named} is read by partitionScheme ${loose ? 'spatialHash' : 'hashSet'} alone`)
  if (!loose && grid.origin.length !== 2)
    refusal(field)(`origin must be two finite numbers, got ${JSON.stringify(grid.origin)}`)
}

/** A job's partition options as a host names them. */
export type PartitionJobOptions = {
  partitionScheme?: PartitionSchemeOption | null
  partitionGrid?: PartitionGridOption | null
  partitionGrids?: PartitionGridsOption | null
}

/** A job's `partitionScheme`, `partitionGrid` and `partitionGrids` fields as the compiler reads
 *  them, each left out when the job names none.
 *  @throws TypeError when a grid names a setting the job's scheme does not read, or the job names
 *  both `partitionGrid` and `partitionGrids`. */
export function partitionJobFields({
  partitionScheme,
  partitionGrid,
  partitionGrids,
}: PartitionJobOptions) {
  const out: {
    partitionScheme?: PartitionScheme
    partitionGrid?: PartitionGridWire
    partitionGrids?: PartitionGridsWire
  } = {}
  const scheme = resolvePartitionScheme(partitionScheme)
  const grid = resolvePartitionGrid(partitionGrid)
  const grids = resolvePartitionGrids(partitionGrids)
  if (grid !== undefined && grids !== undefined)
    refusal(PARTITION_GRIDS_FIELD)(
      `${PARTITION_GRID_FIELD} and ${PARTITION_GRIDS_FIELD} both name the grids: name them once`,
    )
  const loose = (scheme ?? DEFAULT_PARTITION_SCHEME) === 'hashSet'
  if (grid) assertGridFitsScheme(grid, loose, PARTITION_GRID_FIELD)
  grids?.forEach((entry, at) =>
    assertGridFitsScheme(entry, loose, `${PARTITION_GRIDS_FIELD}[${at}]`),
  )
  if (scheme) out.partitionScheme = scheme
  if (grid !== undefined) out.partitionGrid = grid
  if (grids !== undefined) out.partitionGrids = grids
  return out
}

/** A job's partition options as the command line's flags, none for an option the job leaves
 *  out. */
export function partitionFlags(options: PartitionJobOptions): string[] {
  const { partitionScheme, partitionGrid, partitionGrids } = partitionJobFields(options)
  return [
    ...(partitionScheme ? [`${PARTITION_SCHEME_OPTION}${partitionScheme}`] : []),
    ...(partitionGrid === undefined
      ? []
      : [`${PARTITION_GRID_OPTION}${JSON.stringify(partitionGrid)}`]),
    ...(partitionGrids === undefined
      ? []
      : [`${PARTITION_GRIDS_OPTION}${JSON.stringify(partitionGrids)}`]),
  ]
}
