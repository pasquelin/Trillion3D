/**
 * What the compiler and the runtime both state, written once and printed into the compiler's
 * Rust (`scripts/build/shared-rules/abi.ts`, `packages/asset-compiler-rust/src/shared_math/abi.rs`): the
 * one declaration of a compile job's fields, their defaults and their bounds, which the options
 * schema, the SDK's command line and `prepare` read too. The job's own fields are here; the rest
 * is in the modules this one re-exports, so that one path names every part of the ABI:
 * - `hlodAbi.ts`, `hlodApproximationAbi.ts` and `hlodLayerAbi.ts`: the HLOD;
 * - `materialAbi.ts`: the temporal anti-aliasing, the responsive and voxelized objects, the
 *   materials by name;
 * - `partitionAbi.ts`: the partition's main grid;
 * - `meshBuildAbi.ts`: how each mesh is built;
 * - `objectAbi.ts`: each object's settings.
 */

export * from './hlodAbi.ts'
export * from './hlodApproximationAbi.ts'
export * from './hlodLayerAbi.ts'
export * from './materialAbi.ts'
export * from './distanceFieldAbi.ts'
export * from './meshBuildAbi.ts'
export * from './meshCardsAbi.ts'
export * from './objectAbi.ts'
export * from './partitionAbi.ts'
export * from './rayTracingAbi.ts'

/** The triangle budget a compilation keeps when none is named. */
export const DEFAULT_TRIANGLE_BUDGET = 150000
/** The most threads one job may use. */
export const MAX_THREADS = 64
/** The memory the compiler may use, in MB, when none is named: room for the widest HLOD actor,
 *  which runs alone (`hlod/chain`). */
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
