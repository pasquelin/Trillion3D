/**
 * The engine's fixed GPU pool budgets as a host may name them, written once here: the engine draws
 * its pools from them (`../../../sdk-browser/src/residency/pools.ts`) and the schemas an LLM reads
 * state them (`../llm/explorerOptionsSchema.ts`, `../llm/runtimeToolsSchema.ts`).
 */
import { MIB } from '../../../math/src/constants.ts'

/** 512 MiB of geometry pages when the host names no budget. */
export const DEFAULT_GEOMETRY_POOL_BUDGET = 512 * MIB
/** 512 MiB of textures, split between the colour and data atlases
 *  (`../../../sdk-browser/src/webgpu/residency/memoryBudgets.ts`). */
export const DEFAULT_TEXTURE_POOL_BUDGET = 512 * MIB
/** The least pool budget the schemas let a host ask for, 64 MiB. */
export const LEAST_POOL_BUDGET = 64 * MIB
