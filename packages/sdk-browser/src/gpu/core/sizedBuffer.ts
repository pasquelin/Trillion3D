import { grownLength } from '../../../../math/src/sequence/resized.ts'
import { grownByCopy } from './tableGrowth.ts'

/** Makes a buffer, in place of `old` when it replaces one: a cut's (`../dag/cutBuffers.ts`,
 *  `cutBuffer`), which may refuse. */
export type BufferMaker = (descriptor: GPUBufferDescriptor, old?: GPUBuffer) => GPUBuffer

/**
 * The engine's one rule for a GPU list or table grown by the CPU: `held` itself when it holds
 * `bytes`, else a buffer of `usage` made at the grown size (`grownLength`, twice `held`'s at
 * least), then `held` released by the one growth's release (`grownByCopy`): retired, since the
 * image being encoded may still name it. What it held is not copied: the caller tells a buffer
 * made anew by identity. One order whatever makes it — the device, or `make` (a cut's, which may
 * refuse: a refusal throws with `held` whole) —: made first, released after.
 */
export function sizedBuffer(
  device: GPUDevice,
  held: GPUBuffer | undefined,
  bytes: number,
  usage: GPUBufferUsageFlags,
  label: string,
  make?: BufferMaker,
) {
  if (held && held.size >= bytes) return held
  const descriptor = { label, size: grownLength(held ? held.size : 0, bytes), usage }
  const made = make ? make(descriptor, held) : device.createBuffer(descriptor)
  if (held) grownByCopy(device, [held])
  return made
}
