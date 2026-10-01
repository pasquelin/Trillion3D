/**
 * THE CUT'S SIDE OF THE WORLD DAG (#1332, #1333): its residency mirror (`worldMirror.ts`) fed by the
 * rows taken and parked and the world bundles held, and uploaded through the cut's own residency
 * (`residencyUpload.ts`) in two steps. The world's own pages first, whose readiness the upload then
 * settles; the objects' roots linked to the world ranks that moved read again (`worldSeats.ts`) and
 * go up behind. The roots' link words (`worldLinks.ts`) go up as a row seats or leaves its object.
 */
import { SELECTION_NONE as NONE, type ResidencyChanges } from '../core/selection.ts';
import { writeParts, type DagParts } from './split.ts';
import type { PackedDag } from './types.ts';
import type { createDagResidencyUpload } from './residencyUpload.ts';
import { createWorldResidencyMirror } from './worldMirror.ts';

type Handed = { flags: Uint32Array; changes: ResidencyChanges; links: readonly number[] };

/** The world side of a cut whose `packed` holds the world DAG and whose residency `upload` holds;
 *  none otherwise. Each step says whether anything the kernel reads moved. */
export function createWorldResidency(
  resources: { device: GPUDevice; packed: PackedDag; coldParts: DagParts },
  upload: ReturnType<typeof createDagResidencyUpload> | undefined,
) {
  const { device, packed, coldParts } = resources,
    world = packed.world;
  if (!world || !upload) return undefined;
  const mirror = createWorldResidencyMirror({ ...packed, world }, upload.isReady),
    worldBase = packed.cutLinks[world.root].pageBase,
    cones = packed.pageCones;
  const writeLinks = (placements: readonly number[]) => {
    for (const w of placements) {
      const [base, words] = mirror.linkWords(w);
      const at = base * 4;
      if (base !== NONE && words)
        writeParts(
          device,
          coldParts,
          at,
          cones.buffer as ArrayBuffer,
          cones.byteOffset + at,
          words * 4,
        );
    }
    return placements.length > 0;
  };
  /** Uploads what the mirror handed, then the roots whose world rank's readiness moved. */
  const hand = ({ flags, changes, links }: Handed, moved?: (page: number) => void) => {
    const ranks: number[] = [];
    let any = writeLinks(links);
    any =
      upload(flags, changes, (page) => {
        moved?.(page);
        if (page >= worldBase) ranks.push(page);
      }) || any;
    if (!ranks.length) return any;
    const again = mirror.reread(ranks);
    any = writeLinks(again.links) || any;
    return (again.changes.count > 0 && upload(again.flags, again.changes, moved)) || any;
  };
  return {
    get hostBytes() {
      return mirror.hostBytes;
    },
    /** Scene placement `w`, posed by `pose`, draws world object `object`, or none (-1). */
    seat(w: number, object: number, pose?: ArrayLike<number>) {
      mirror.seat(w, object, pose);
      return hand(mirror.flush());
    },
    /** The world bundles held now (`WorldRootsHold`): the `pinned` top and `held`. */
    hold(pinned: number, held: readonly number[]) {
      mirror.holdBundles(pinned, held);
      return hand(mirror.flush());
    },
    /** The rows' residency `next` at `changes`, mirrored and uploaded; `moved` as the upload's. */
    update: (next: Uint32Array, changes?: ResidencyChanges, moved?: (page: number) => void) =>
      hand(mirror.update(next, changes), moved),
  };
}
