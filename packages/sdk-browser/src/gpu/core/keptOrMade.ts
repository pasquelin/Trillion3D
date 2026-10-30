import { ledgerAdmitted } from './deviceLedger.ts'
import { retire } from './frameRetire.ts'

/** The updates in a row that ask at most a quarter of what a resource held before it is made again at the size asked. A memory
 *  housekeeping rule with no effect on the image: the resources of a frame only grow with what is asked, and a full update, which asks
 *  the most, would otherwise leave its size held for good. */
export const SHRINK_AFTER_UPDATES = 30

/** The share of what is held that an update must ask at most, to count toward the resource being made again smaller. */
const SHRINK_SHARE = 1 / 4

/**
 * The updates in a row that asked at most a quarter of the `held` size, `small` before this one, `asked` now: the count after
 * it (none where this update asked more), and whether it has reached `SHRINK_AFTER_UPDATES`, the resource then made again at the size asked.
 */
function lingers(small: number, asked: number, held: number) {
  const count = asked <= held * SHRINK_SHARE ? small + 1 : 0
  return { count, shrink: count >= SHRINK_AFTER_UPDATES }
}

/** A resource that is given back by retiring it (`destroy`) or by its own `dispose`, which retires what it holds. */
type GivenBack = { destroy(): void } | { dispose(): void }

/**
 * A resource of the frame kept or made: the `held` one where it `holds` what is asked and the updates in a row that asked at most a quarter of its `texels` (`small` before this
 * one, `asked` texels now) have not reached `SHRINK_AFTER_UPDATES`, with the count after this update; else made at the size `admit` asks, where the device's budget leaves
 * room (`ledgerAdmitted`, the held one's bytes credited) — none where it does not — and the count none. The one it replaces is given back: by its own `dispose`, else retired (destroyed
 * once the image that names it is submitted). `atlas` is the resource to use; `held` the one now held. They differ only with `keepOnRefusal` (for a swap of the same size class or a shrink, never a grow): the held one is then given back only once the new one was
 * made, and a refusal keeps it held (`atlas` it where it holds what is asked, else none), so that a refused swap does not drop what works; a refused shrink starts its count again.
 */
export function keptOrMade<T extends { bytes: number } & GivenBack>(
  device: GPUDevice,
  held: T | undefined,
  keep: { holds: boolean; small: number; asked: number; texels: number; keepOnRefusal?: boolean },
  admit: { asked: number; what: string; make: () => T },
) {
  let shrinking = false
  if (held && keep.holds) {
    const { count, shrink } = lingers(keep.small, keep.asked, keep.texels)
    if (!shrink) return { atlas: held, held, small: count }
    shrinking = true
  }
  let made = false
  const { value } = ledgerAdmitted(device, {
    held: held && {
      bytes: held.bytes,
      dispose: () => {
        if (!made && keep.keepOnRefusal) return
        if ('dispose' in held) held.dispose()
        else retire(device, held)
      },
    },
    ...admit,
    make: () => {
      const resource = admit.make()
      made = true
      return resource
    },
  })
  if (value || !keep.keepOnRefusal) return { atlas: value, held: value, small: 0 }
  // A refused shrink starts its count again (no retry each image); a refused swap leaves the count of the one held to its own asks.
  return { atlas: keep.holds ? held : undefined, held, small: shrinking ? 0 : keep.small }
}
