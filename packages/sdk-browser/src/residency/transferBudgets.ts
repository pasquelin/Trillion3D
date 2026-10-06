/**
 * THE MAPS' UPLOAD BUDGETS OF A FRAME, both engines': WebGPU's tile pass
 * (`../webgpu/pages/prepare/setup.ts`) and WebGL2's maps uploaded ahead of the draws
 * (`../webgl/cluster/textureQueue.ts`).
 */

import {
  DEFAULT_TEXTURE_TRANSFER_BYTES,
  DEFAULT_TEXTURE_UPLOAD_MS,
} from './textureTransferDefaults.ts'

/** A tile pass budget for what the host declared: the default when it declared nothing finite,
 *  never below `floor` — one byte, or zero milliseconds: one tile per pass still lands. */
const budgetFor = (declared: number | undefined, fallback: number, floor: number) =>
  Math.max(floor, Number.isFinite(declared) ? declared! : fallback)
export const textureTransferBytesFor = (declared: number | undefined) =>
  budgetFor(declared, DEFAULT_TEXTURE_TRANSFER_BYTES, 1)
export const textureUploadMsFor = (declared: number | undefined) =>
  budgetFor(declared, DEFAULT_TEXTURE_UPLOAD_MS, 0)
