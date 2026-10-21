/**
 * The engine's fixed GPU pool budgets as a host may name them, written once here: the engine draws
 * its pools from them (`../../../sdk-browser/src/session/memory/pools.ts`) and the schemas an LLM
 * reads state them (`../llm/explorerOptionsSchema.ts`, `../llm/runtimeToolsSchema.ts`). The
 * streaming's own settings are `./streamingOptions.ts`.
 */
// Spelled in literals (2 ** 20 bytes a MiB), not through `MIB`: a product of an imported value is
// one the bundler cannot prove free of effects, and every bundle reaching the schemas would keep it.

/** 512 MiB of streamed geometry pages when the host names no budget: the root cover is held beside
 *  them, never in them (`../../../sdk-browser/src/session/memory/pools.ts`). */
export const DEFAULT_GEOMETRY_POOL_BUDGET = 512 * 2 ** 20
/** 512 MiB of textures, split between the colour and data atlases
 *  (`../../../sdk-browser/src/geometry/residency/memoryBudgets.ts`). */
export const DEFAULT_TEXTURE_POOL_BUDGET = 512 * 2 ** 20
/** The least pool budget the schemas let a host ask for, 64 MiB. */
export const LEAST_POOL_BUDGET = 64 * 2 ** 20
