import type { MeasuredWorld } from '../session/explorer.ts';
import type { createWorldContents } from './worldContents.ts';
import type { buildWorldSource } from './worldSource.ts';
import type { Batch } from './worldBatches.ts';
import type { Cut } from './worldCuts.ts';

type Contents = ReturnType<typeof createWorldContents>;
type Source = NonNullable<ReturnType<typeof buildWorldSource>>;
type Mounting = Pick<MeasuredWorld, 'mountsPlacements' | 'mountPlacements' | 'unmountPlacements'>;

/**
 * THE MOUNT IN PLACE (#572): no content change opens the session again. After each seating, the
 * batches no mesh draws any more leave the open session — their resource released once no batch
 * it draws wears it —, and those it was not opened with enter it (`mountPlacements`): their pages
 * into its cache, their roots into its tables, their host mesh into its graph. Their meshes take
 * their rows once the session draws them, each keeping the row it left drawn until then
 * (`worldBatches.ts`): a mount drawn asks the runtime's next resolution (`schedule`), which seats
 * them, and one that failed its next opening (`reopen`), while `open` is the session it went to.
 */
export function createWorldMounts(
  contents: Contents,
  open: () => Mounting | null,
  schedule: () => void,
  reopen: () => void,
) {
  const { cuts } = contents;
  /** The resources the open session reads: their pages stay served. */
  let held = new Set<Cut>();
  return {
    /** A session is about to open on `batches`: their resources are held. The returned call,
     *  once the session before it is closed, releases those it alone read. */
    opening(batches: readonly Batch[]) {
      const next = new Set(batches.map((batch) => batch.cut));
      for (const cut of next) cuts.hold(cut, true);
      return () => {
        for (const cut of held) if (!next.has(cut)) cuts.hold(cut, false);
        held = next;
      };
    },
    /** Unmounts the vacant batches from `session`, and mounts the new ones. */
    apply(source: Source, session: Mounting) {
      console.warn("MOUNTAPPLY", session.mountsPlacements());
      if (!session.mountsPlacements()) return;
      for (const batch of contents.vacant()) {
        console.warn('UNMOUNT', batch.key.slice(0, 20));
        session.unmountPlacements(batch.rows!);
        source.unmount(batch);
        if (contents.wears(batch.cut)) continue;
        held.delete(batch.cut);
        cuts.hold(batch.cut, false);
      }
      for (const batch of contents.mountable()) {
        held.add(batch.cut);
        cuts.hold(batch.cut, true);
        console.warn('MOUNTSTART', batch.key.slice(0, 20));
        session.mountPlacements(source.mount(batch)).then(
          () => {
            console.warn('MOUNTDONE', batch.key.slice(0, 20));
            contents.mounted(batch);
            if (open() === session) schedule();
          },
          (e) => (console.warn("MOUNTFAIL", e?.stack ?? e), open() === session && reopen()),
        );
      }
    },
  };
}
