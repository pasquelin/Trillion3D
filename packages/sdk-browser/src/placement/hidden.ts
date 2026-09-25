import { BOX_VALUES, boxEmpty, boxIsEmpty, boxUnionBatch } from '../../../sdk-core/src/index.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import { rowParked, type PlacementOf } from './rows.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';

/** A see-through draw — a WebGPU blend item, a WebGL2 blended copy — as visibility reads it:
 *  hidden with its source node, parked with its row. */
export type SeeThrough = { hidden?: boolean; readonly placement?: PlacementOf };

/** True when `entry` is not drawn: its source node is hidden, or its row parked. */
export const notDrawn = (entry: SeeThrough) => !!entry.hidden || rowParked(entry.placement);

/** True when `node` and every node above it are visible. */
export function shownChain(node: Object3D) {
  for (let walk: Object3D | null = node; walk; walk = walk.parent) if (!walk.visible) return false;
  return true;
}

/**
 * Sets `hidden` on each entry from its source node's chain, and hands each entry that flipped to
 * `flipped`. Consecutive entries of one source share one walk.
 */
function followHidden<E extends { hidden?: boolean }>(
  entries: readonly E[],
  sourceOf: (entry: E) => Object3D | undefined,
  flipped: (entry: E, rank: number) => void,
) {
  let last: Object3D | undefined,
    lastHidden = false;
  for (let rank = 0; rank < entries.length; rank++) {
    const entry = entries[rank],
      source = sourceOf(entry);
    if (!source) continue;
    if (source !== last) {
      last = source;
      lastHidden = !shownChain(source);
    }
    if (lastHidden === !!entry.hidden) continue;
    entry.hidden = lastHidden;
    flipped(entry, rank);
  }
}

/** The box the roots that flipped cover, as one union. */
const moved = new Float64Array(BOX_VALUES),
  movedMin = [0, 0, 0],
  movedMax = [0, 0, 0];

/**
 * Brings the roots and the see-through draws level with the visibility the host wrote on the
 * source graph. A root whose source node, or one of its ancestors, is hidden is parked as a parked
 * row is — every cut, the light cuts included, skips it, its tables stay —, and taken back once
 * shown again, unless its row is parked; `park` hears the rank of each root that flipped. A
 * see-through draw of a hidden node takes `hidden`, which its selection reads (`notDrawn`), and
 * `seeThrough.flipped` hears it. Read once per scene revision, never per frame. Returns the box
 * of the roots that flipped, where the shadow pages must be drawn again, or `null`.
 */
export function followHostVisibility<T extends { sourceMesh?: Object3D }, S extends SeeThrough>(
  roots: readonly ClusterRoot<T>[],
  seeThrough: {
    entries: readonly S[];
    sourceOf: (entry: S) => Object3D | undefined;
    flipped?: (entry: S) => void;
  },
  park?: (rank: number, parked: boolean) => void,
) {
  boxEmpty(moved, 0);
  followHidden(
    roots,
    (root) => root.pages[0]?.sourceMesh,
    (root, rank) => {
      const parked = !!root.hidden || rowParked(root.placement);
      if (parked === !!root.parked) return;
      root.parked = parked;
      park?.(rank, parked);
      if (root.worldBox) boxUnionBatch(moved, root.worldBox, 1);
    },
  );
  followHidden(seeThrough.entries, seeThrough.sourceOf, (entry) => seeThrough.flipped?.(entry));
  if (boxIsEmpty(moved, 0)) return null;
  for (let axis = 0; axis < 3; axis++) {
    movedMin[axis] = moved[axis];
    movedMax[axis] = moved[axis + 3];
  }
  return { min: movedMin, max: movedMax };
}
