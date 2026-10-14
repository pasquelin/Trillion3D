import { grownLength } from '../../../../math/src/sequence/resized.ts'

/**
 * The engine's one rule for a GPU list or table grown by the CPU: `held` itself when it holds
 * `bytes`, else `held` destroyed and a buffer of `usage` made at the grown size (`grownLength`, twice
 * `held`'s at least) — what it held is not copied. The caller tells a buffer made anew by identity.
 */
export function sizedBuffer(
  device: GPUDevice,
  held: GPUBuffer | undefined,
  bytes: number,
  usage: GPUBufferUsageFlags,
  label: string,
) {
  if (held && held.size >= bytes) return held
  const size = grownLength(held ? held.size : 0, bytes)
  held?.destroy()
  return device.createBuffer({ label, size, usage })
}
