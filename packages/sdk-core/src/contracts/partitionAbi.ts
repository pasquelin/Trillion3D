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
