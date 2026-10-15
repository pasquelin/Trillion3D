import { HOLD_IDLE_MS } from './heldBuffers.ts'
import { createReadbackRing, type ReadbackRing } from './readbackRing.ts'

/** Captures one device reads back at once: past them, a capture waits for one to land. */
const CAPTURES_IN_FLIGHT = 4

/** One capture as its ring buffer carries it: the chained read the ring hands back, and what
 *  reads the mapped range. */
type Capture = { run?: () => Promise<void>; read: (mapped: ArrayBuffer) => void }

/** A device's capture ring, and the timer that destroys it once no capture came. */
type Held = { ring: ReadbackRing<Capture>; active: number; idle?: ReturnType<typeof setTimeout> }
const held = new WeakMap<GPUDevice, Held>()

/** The device's ring of the engine's one staging pool (`createReadbackRing`), chained: a capture
 *  awaits its own mapping. Made at the first capture, destroyed `HOLD_IDLE_MS` after the last. */
function captureRing(device: GPUDevice) {
  let hold = held.get(device)
  if (!hold) {
    const ring = createReadbackRing<Capture>(
      device,
      {
        label: 'Trillion3D explicit capture',
        bytes: 4,
        count: CAPTURES_IN_FLIGHT,
        chain: (run, capture) => void (capture.run = run),
      },
      (mapped, _staging, capture) => capture.read(mapped),
    )
    held.set(device, (hold = { ring, active: 0 }))
  }
  clearTimeout(hold.idle)
  hold.active++
  return hold
}

/** A capture done: `hold` destroyed once no capture came for `HOLD_IDLE_MS` after the last one
 *  in flight — a scene at rest holds no byte. */
function rest(device: GPUDevice, hold: Held) {
  if (--hold.active > 0) return
  clearTimeout(hold.idle)
  hold.idle = setTimeout(() => {
    hold.ring.destroy()
    held.delete(device)
  }, HOLD_IDLE_MS)
  // A host process never waits on the hold.
  ;(hold.idle as { unref?: () => void }).unref?.()
}

/**
 * THE explicit capture, never a frame's: `bytes` taken from the device's capture ring, `encode`
 * copying into it, submitted, mapped, `read` from its mapped range (`bytes` long at least), given
 * back. `signal` is checked once mapped. The proof tools and an explicit capture read through it.
 */
export async function captureRead<T>(
  device: GPUDevice,
  bytes: number,
  label: string,
  encode: (encoder: GPUCommandEncoder, staging: GPUBuffer) => void,
  read: (mapped: ArrayBuffer) => T,
  signal?: AbortSignal,
): Promise<T> {
  const hold = captureRing(device)
  let value: T | undefined
  const capture: Capture = { read: (mapped) => void (value = read(mapped)) }
  let staging = hold.ring.take(capture, bytes)
  while (!staging) {
    await hold.ring.settled()
    staging = hold.ring.take(capture, bytes)
  }
  try {
    const encoder = device.createCommandEncoder({ label })
    encode(encoder, staging)
    device.queue.submit([encoder.finish()])
  } catch (error) {
    hold.ring.dropped(staging)
    rest(device, hold)
    throw error
  }
  hold.ring.submitted(staging)
  try {
    await capture.run!()
  } finally {
    rest(device, hold)
  }
  signal?.throwIfAborted()
  return value as T
}
