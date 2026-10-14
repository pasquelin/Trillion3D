import { grownLength } from '../../../../math/src/sequence/resized.ts'
import type { BufferMaker } from '../dag/cutBuffers.ts'

/**
 * The engine's one rule for a GPU list or table grown by the CPU: `held` itself when it holds
 * `bytes`, else `held` destroyed and a buffer of `usage` made at the grown size (`grownLength`, twice
 * `held`'s at least) — what it held is not copied. The caller tells a buffer made anew by identity.
 * A buffer `make` makes in `held`'s place — a cut's (`cutBuffer`), which may refuse — is made
 * first: a refusal throws with `held` whole.
 */
export function sizedBuffer(
  device: Pick<GPUDevice, 'createBuffer'>,
  held: GPUBuffer | undefined,
  bytes: number,
  usage: GPUBufferUsageFlags,
  label: string,
  make?: BufferMaker,
) {
  if (held && held.size >= bytes) return held
  const descriptor = { label, size: grownLength(held ? held.size : 0, bytes), usage }
  if (!make) {
    held?.destroy()
    return device.createBuffer(descriptor)
  }
  const made = make(descriptor, held)
  held?.destroy()
  return made
}
