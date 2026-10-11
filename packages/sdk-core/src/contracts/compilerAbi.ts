/**
 * What the compiler and the runtime both state, written once here and printed into the compiler's
 * Rust (`scripts/shared-rules/abi.ts`, `packages/asset-compiler-rust/src/shared_math/abi.rs`).
 */

/** Triangles a cluster holds at most: the page format's cluster, the one the compiler cuts
 *  (`docs/FORMAT.md`). */
export const DAG_CLUSTER_TRIANGLES = 128
/** Vertices a cluster holds at most; a cluster of `DAG_CLUSTER_TRIANGLES` never needs more. */
export const DAG_CLUSTER_VERTICES = 255

/** The triangle budget a compilation keeps when none is named. */
export const DEFAULT_TRIANGLE_BUDGET = 150000
/** The threads the compiler may use when none are named. */
export const DEFAULT_THREADS = 2
/** The memory the compiler may use, in MB, when none is named. */
export const DEFAULT_RAM_BUDGET_MB = 256
