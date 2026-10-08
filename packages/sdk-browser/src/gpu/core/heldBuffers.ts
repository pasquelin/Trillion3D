import { oncePerDevice } from './oncePerDevice.ts'
import { nextPow2 } from '../../../../math/src/scalar/integers.ts'

/**
 * Buffers a device holds between the uses that take them, one a slot, so a burst of uses
 * allocates once instead of a buffer made and destroyed each. Each holder keeps its own slots per
 * device (`oncePerDevice`), mutated in place:
 * - `take` lends the held buffer when it fits — out of the hold: two uses in flight never share
 *   one —, else makes one; `give` puts it back, the one it replaces destroyed (under `larger`, the
 *   larger of the two kept). With `idleMs`, everything held is destroyed once nothing was given
 *   back for that long: a scene at rest holds no byte of it.
 * - `grow` keeps a buffer that rewrites itself in queue order and is never lent, grown to the next
 *   power of two when outgrown — a stream of slightly larger asks reallocates rarely —, the
 *   outgrown one destroyed once the work submitted so far, which may read it, is done.
 */
export function heldBuffers(idleMs?: number) {
  const holdOf = oncePerDevice(() => ({
    held: new Map<string, GPUBuffer>(),
    idle: undefined as ReturnType<typeof setTimeout> | undefined,
  }))
  /** Restarts the hold's idle time: everything it holds is destroyed once it runs out. */
  const rest = (hold: ReturnType<typeof holdOf>) => {
    if (idleMs === undefined) return
    clearTimeout(hold.idle)
    hold.idle = setTimeout(() => {
      for (const buffer of hold.held.values()) buffer.destroy()
      hold.held.clear()
    }, idleMs)
    // A host process never waits on the hold.
    ;(hold.idle as { unref?: () => void }).unref?.()
  }
  return {
    /** The buffer held under `slot` when it holds `size` bytes (exactly `size` under `exact`),
     *  taken out of the hold; else a new one, named `label` (the slot's name by default). */
    take(
      device: GPUDevice,
      slot: string,
      size: number,
      usage: number,
      { exact = false, label = slot }: { exact?: boolean; label?: string } = {},
    ) {
      const { held } = holdOf(device),
        kept = held.get(slot)
      if (kept && (exact ? kept.size === size : kept.size >= size)) {
        held.delete(slot)
        return kept
      }
      return device.createBuffer({ label, size, usage })
    },
    /** Gives `buffer` back under `slot`, unmapped: held for the next use, the one it replaces
     *  destroyed — or, under `larger`, the smaller of the two. */
    give(device: GPUDevice, slot: string, buffer: GPUBuffer, larger = false) {
      const hold = holdOf(device),
        kept = hold.held.get(slot)
      if (larger && kept && kept.size >= buffer.size) buffer.destroy()
      else {
        if (kept !== buffer) kept?.destroy()
        hold.held.set(slot, buffer)
      }
      rest(hold)
    },
    /** The buffer kept under `label`, of `size` bytes at least: made, or grown, when it is not. */
    grow(device: GPUDevice, label: string, size: number, usage: number) {
      const { held } = holdOf(device),
        kept = held.get(label)
      if (kept && kept.size >= size) return kept
      // The power of two at or above `size`, never 0 bytes (`2 **`, not `1 <<`: past 1 GiB a shift
      // turns negative; `nextPow2` is exact for an integer size).
      const pow2 = nextPow2(size)
      const buffer = device.createBuffer({ label, size: pow2, usage })
      held.set(label, buffer)
      if (kept) void device.queue.onSubmittedWorkDone().then(() => kept.destroy())
      return buffer
    },
  }
}
