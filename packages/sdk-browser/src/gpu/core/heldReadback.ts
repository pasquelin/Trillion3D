import { heldBuffers } from './heldBuffers.ts'

/** How long a buffer stays held with no capture taking it: a burst of captures (an A/B proof,
 *  rounds until a cut lands) shares one; a capture now and then holds nothing between. */
export const READBACK_IDLE_MS = 1000

/**
 * The mapped buffer an explicit capture reads a texture back through, held per device between
 * captures (`heldBuffers`): a capture of the size held takes it, one of another size or made while
 * it is lent takes a fresh one. One buffer is held, the last given back — the size the next capture
 * most likely asks —; any other is destroyed once its capture read it, and the held one once no
 * capture took it for `READBACK_IDLE_MS`.
 */
const readbacks = heldBuffers(READBACK_IDLE_MS)
/** The hold's one slot, whatever label the capture gave its buffer. */
const READBACK_SLOT = 'readback'

/** A `COPY_DST | MAP_READ` buffer of `size` bytes, unmapped: the one held when it has that size. */
export const takeReadback = (device: GPUDevice, size: number, label: string) =>
  readbacks.take(device, READBACK_SLOT, size, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, {
    exact: true,
    label,
  })

/** Gives back `buffer`, unmapped, read in full: held for the next capture, the one it replaces
 *  destroyed; destroyed too once idle. */
export const giveReadback = (device: GPUDevice, buffer: GPUBuffer) =>
  readbacks.give(device, READBACK_SLOT, buffer)
