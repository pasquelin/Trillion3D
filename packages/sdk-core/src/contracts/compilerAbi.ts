/**
 * What the compiler and the runtime both state, written once here and printed into the compiler's
 * Rust (`scripts/shared-rules/abi.ts`, `packages/asset-compiler-rust/src/shared_math/abi.rs`).
 */

/** The triangle budget a compilation keeps when none is named. */
export const DEFAULT_TRIANGLE_BUDGET = 150000
/** The threads the compiler may use when none are named. */
export const DEFAULT_THREADS = 2
/** The memory the compiler may use, in MB, when none is named. */
export const DEFAULT_RAM_BUDGET_MB = 256
