import type { EngineCamera } from '../camera/world.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import type { PageRec } from '../page/selection/selection.ts';
import type { HostWorldPlacements } from '../host/world/placements.ts';
import { createSessionDeformation } from './session.ts';
import { createDeformationSkip } from './screen.ts';

/**
 * A WebGL2 session's deformation (#357): the records of its roots (`session.ts`), which the
 * program reads as a texture of their own (`../webgl/cluster/deformation.ts`) — each record named
 * from float zero, so a page mesh carries its record's first float plus one (`wordOf`). Each image
 * (`update`), once its worlds are current, writes the records, sets each deformed root's reach
 * for the cut and counts a new `version` when one moved; `pending` says the next image would
 * write other records, which a held frame would not show.
 */
export function createWebglDeformation(
  roots: readonly ClusterRoot<PageRec>[],
  worlds: Pick<HostWorldPlacements, 'of'>,
) {
  const session = createSessionDeformation(roots, worlds),
    frame = session.frame,
    skip = createDeformationSkip(),
    source = { block: frame.block, bases: frame.bases, version: 0 };
  return {
    /** The records the program reads, none when no root deforms. */
    source: () => (session.any ? source : undefined),
    /** What a page mesh of `rec` carries: its placement's record, zero for none. */
    wordOf: (rec: PageRec) => session.wordOfWorld(rec.matrix),
    pending: () => session.any && frame.pending(),
    update(cam: EngineCamera, viewport: readonly number[] | undefined, pixelError: number) {
      if (!session.any) return;
      const moved = frame.update(skip(roots, cam, viewport, pixelError));
      for (let i = 0; i < frame.bases.length; i++)
        if (frame.bases[i]) roots[i].reach = frame.reach[i];
      if (moved) source.version++;
    },
  };
}

export type WebglDeformation = ReturnType<typeof createWebglDeformation>;
