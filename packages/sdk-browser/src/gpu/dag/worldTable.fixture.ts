// A whole worlds' table on a device, as the engine's host writes it (`cameraFrames.ts`): each
// placement's matrix and its exact translation beside it (`createWorldOrigins`), for the browser
// proofs that bind the selection kernel by hand.
import { createWorldOrigins } from './worldOrigins.ts'
import { createRecordTexture } from '../core/recordTexture.ts'
import { WORLD_TABLE } from './worldTable.ts'
import type { PackedDag } from './types.ts'

/** The worlds' table of `worlds` (sixteen floats a placement) and `sources` on `device`. */
export function worldTableOn(
  device: GPUDevice,
  worlds: Float32Array,
  sources: PackedDag['worldSources'],
) {
  const count = Math.max(1, worlds.length / 16),
    usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  const table = createRecordTexture(device, WORLD_TABLE, count, usage)
  table.write('Matrix', 0, worlds.length / 16, worlds.buffer as ArrayBuffer, worlds.byteOffset)
  createWorldOrigins(count, table.target('Origin'), sources).write()
  return table
}
