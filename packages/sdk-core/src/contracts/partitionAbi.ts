/**
 * The partition's main grid as the job names it: its field, its flag and the defaults and bound the
 * compiler's Rust is printed with (`compilerAbi.ts` re-exports them; `partitionOptions.ts` holds
 * the settings the grid may name).
 */

/** The job field setting the partition's main grid (`resolvePartitionGrid`): the grid every
 *  spatially loaded object streams on, of the job's scheme (`PARTITION_SCHEME_FIELD`,
 *  `partitionOptions.ts`) — its cells of `cellSize` metres doubled level by level, on `origin`
 *  (its two ground axes, glTF's `x` and `z`), each loaded while the view lies within
 *  `loadingRange` metres of it, in the load order of `priority` among the grids, the lower the
 *  sooner (each HLOD grid's 0 under `hashSet`, 100 plus its level under `spatialHash`). `true`
 *  names every default, an object the settings it names over them,
 *  `false` turns the streaming off: every object is loaded with the scene, no cell is cut and no
 *  HLOD is built. The command line's `--partition-grid=` flag holds it as JSON. A job leaving it
 *  out keeps its cache key. */
export const PARTITION_GRID_FIELD = 'partitionGrid'
/** The command line's flag setting the partition's main grid, its JSON after the `=`. The
 *  settings it may name, each scheme's own among them, are `partitionOptions.ts`'s. */
export const PARTITION_GRID_OPTION = '--partition-grid='
/** The main grid's cell side, metres, when the job names none: the reference's main grid's. */
export const DEFAULT_PARTITION_CELL_SIZE = 128
/** The main grid's loading range, metres, when the job names none: the reference's main grid's. */
export const DEFAULT_PARTITION_LOADING_RANGE = 256
/** The main grid's priority when the job names none: the reference's main grid's. */
export const DEFAULT_PARTITION_PRIORITY = 0
/** The most a grid's priority may be: a 32-bit word of the partition's root. */
export const MAX_PARTITION_PRIORITY = 0xffffffff
/** The job field naming several streaming grids, one per entry (`resolvePartitionGrids`): each the
 *  settings `partitionGrid` takes under a `name` — the first the default grid, which every object
 *  naming no grid, or one this list does not hold, streams on —, each grid with its own cells,
 *  loading range and chain of HLOD grids, an object choosing its grid by the `runtimeGrid` of its
 *  settings (`objectAbi.ts`). A job names `partitionGrid` or `partitionGrids`, not both. The
 *  command line's `--partition-grids=` flag holds it as JSON. A job leaving it out keeps its cache
 *  key. */
export const PARTITION_GRIDS_FIELD = 'partitionGrids'
/** The command line's flag naming the streaming grids, their JSON after the `=`. */
export const PARTITION_GRIDS_OPTION = '--partition-grids='
/** The key of an entry of `partitionGrids` holding the grid's name, beside the settings
 *  `partitionGrid` takes. A name is not empty, holds neither `:` nor `.`, and is told from
 *  another's without regard to case. */
export const PARTITION_GRID_NAME_KEY = 'name'
/** The characters a grid's name may not hold, which a grid name splits into parts by: a name
 *  holding one can never be matched. Read by the grids' names and by `runtimeGrid`. */
export const PARTITION_GRID_NAME_FORBIDDEN = ':.'
/** The name of the first grid when its entry names none, and of the only grid of a job naming no
 *  `partitionGrids`: the reference's first partition's. */
export const DEFAULT_PARTITION_GRID_NAME = 'MainPartition'
