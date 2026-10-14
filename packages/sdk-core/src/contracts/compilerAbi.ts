/**
 * What the compiler and the runtime both state, written once here and printed into the compiler's
 * Rust (`scripts/shared-rules/abi.ts`, `packages/asset-compiler-rust/src/shared_math/abi.rs`): the
 * one declaration of a compile job's fields, their defaults and their bounds, which the options
 * schema, the SDK's command line and `prepare` read too.
 */

/** The triangle budget a compilation keeps when none is named. */
export const DEFAULT_TRIANGLE_BUDGET = 150000
/** The threads the compiler may use when none are named. */
export const DEFAULT_THREADS = 2
/** The most threads one job may use. */
export const MAX_THREADS = 64
/** The memory the compiler may use, in MB, when none is named. */
export const DEFAULT_RAM_BUDGET_MB = 256
/** The least memory one job needs to decode the smallest scene, in MB. */
export const MIN_RAM_BUDGET_MB = 64
/** How meshes may be simplified; the first, `'none'`, is the default. */
export const SIMPLIFICATIONS = ['none', 'qem-endpoints'] as const
/** The simplification a job runs when it names none. */
export const DEFAULT_SIMPLIFICATION: Simplification = 'none'
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
