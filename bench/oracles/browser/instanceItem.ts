import { INSTANCE_ITEM_MASK } from '../../../packages/sdk-browser/src/webgpu/blend/runs.ts'

/** The item rank of an expanded instance's first word (`instanceWord` packs it, the vertex stage
 *  reads it): what the expansion's tests and the bench read back, the engine itself never does. */
export const instanceItem = (word: number) => word & INSTANCE_ITEM_MASK
