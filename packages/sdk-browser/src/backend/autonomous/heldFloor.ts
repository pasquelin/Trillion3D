import type { PageRec } from '../../page/selection/selection.ts';

import { hostPageBytes } from '../../host/pageObjects.ts';
import { attachedPages } from '../../placement/autonomousPlacements.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';

/**
 * Decoded bytes nothing may evict: the root cover and the pages the host replaced, counted as the
 * store's `allocationBytes` counts them — every geometry a record holds, an instance's copies
 * included, and a geometry several records share once. Read again only after `changed` —
 * prepare, an instance added or removed, rows grown, a page replaced —: a pose or a material
 * leaves them as they are.
 */
export function createHeldFloor(env: {
  bootstrap: readonly PageRec[];
  modifiedPages: ReadonlySet<string>;
  byUrl: ReadonlyMap<string, readonly PageRec[]>;
}) {
  const { bootstrap, modifiedPages, byUrl } = env;
  let revision = 0,
    read = -1,
    bytes = 0,
    counted = -1,
    meshes = 0;
  return {
    /** What the root cover holds changed; the pool reads the same revision (`coverRevision`). */
    changed() {
      revision++;
    },
    get revision() {
      return revision;
    },
    bytes() {
      if (read === revision) return bytes;
      read = revision;
      bytes = 0;
      const seen = new Set<Geometry>();
      const add = ({ geometry }: PageRec) => {
        if (!geometry || seen.has(geometry)) return;
        seen.add(geometry);
        bytes += hostPageBytes(geometry);
      };
      for (const rec of bootstrap) add(rec);
      for (const url of modifiedPages) for (const rec of byUrl.get(url) ?? []) add(rec);
      return bytes;
    },
    /** The display meshes the root cover hangs (`attachedPages`), read again only after
     *  `changed`: a transparent page counts once per row that places it. */
    meshes() {
      if (counted === revision) return meshes;
      counted = revision;
      return (meshes = attachedPages(bootstrap));
    },
  };
}

export type HeldFloor = ReturnType<typeof createHeldFloor>;
