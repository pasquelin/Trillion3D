import type { MeasuredWorld } from '../session/explorer.ts'
import type { createWorldContents } from './worldContents.ts'
import type { buildWorldSource } from './worldSource.ts'
import type { Batch } from './worldBatches.ts'
import type { Cut } from './worldCuts.ts'

type Contents = ReturnType<typeof createWorldContents>
type Source = NonNullable<ReturnType<typeof buildWorldSource>>
type Mounting = Pick<MeasuredWorld, 'mountsPlacements' | 'mountPlacements' | 'unmountPlacements'>

/**
 * THE MOUNT IN PLACE: after each seating, the batches no mesh draws leave the open session
 * and those it was not opened with enter it (`mountPlacements`). A mount drawn asks the next
 * seating (`schedule`), a failed one the next opening (`reopen`), while `open` is its session.
 */
export function createWorldMounts(
  contents: Contents,
  open: () => Mounting | null,
  schedule: () => void,
  reopen: () => void,
) {
  const { cuts } = contents
  /** The resources the open session reads: their pages stay served. */
  let held = new Set<Cut>()
  return {
    /** Holds the resources of `batches`; the call returned releases those only the last read. */
    opening(batches: readonly Batch[]) {
      const next = new Set(batches.map((batch) => batch.cut))
      for (const cut of next) cuts.hold(cut, true)
      return () => {
        for (const cut of held) if (!next.has(cut)) cuts.hold(cut, false)
        held = next
      }
    },
    /** Unmounts the vacant batches from `session`, and mounts the new ones. */
    apply(source: Source, session: Mounting) {
      if (!session.mountsPlacements()) return
      for (const batch of contents.vacant()) {
        session.unmountPlacements(batch.rows!)
        if (!source.unmount(batch)) continue
        held.delete(batch.cut)
        cuts.hold(batch.cut, false)
      }
      for (const batch of contents.mountable()) {
        // Control records are sized with a session; a new deformation resource needs a new layout.
        if (batch.cut.drawn.deformation || [...batch.wearers].some((m) => m.waves)) {
          reopen()
          continue
        }
        held.add(batch.cut)
        cuts.hold(batch.cut, true)
        session.mountPlacements(source.mount(batch)).then(
          () => {
            contents.mounted(batch)
            if (open() === session) schedule()
          },
          () => open() === session && reopen(),
        )
      }
    },
  }
}
