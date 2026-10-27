import type { ClusterRoot } from '../geometry/selection/types.ts'
import { rowParked, type PlacementOf } from './rows/rows.ts'
import {
  HIDDEN_SHADOW_ROOT,
  markCasting,
  nodeCasting,
  SHADOWLESS_ROOT,
} from '../visibility/shader/castingMark.ts'
import { rootedUnder } from '../scene/host/world/rooted.ts'
import type { ViewHidden } from '../frame/render/viewHidden.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

/** A see-through draw — a blend item — as visibility reads it: hidden with its source node, or
 *  parked with its row. Whether its row's HLOD 0 cell draws its placements is read on the GPU, from
 *  the very state word the descent gates an opaque placement by (`../blend/verdict/verdictWgsl.ts`):
 *  every primitive of a source shows and hides with its cell, a blended one too. */
export type SeeThrough = { hidden?: boolean; readonly placement?: PlacementOf }

/** True when `entry` is not drawn as the host sees it: its source node is hidden or its row
 *  parked. */
export const notDrawn = (entry: SeeThrough) => !!entry.hidden || rowParked(entry.placement)

/** The scene node a root draws, the one resolver of it: its first page's mesh, or, for a root an
 *  instance row places — a world's batch, a loaded model's mesh —, the mesh that row belongs to
 *  (`PlacementRows.sources`). The readers the row itself follows — its pose, its flag, its shadow
 *  bit, written by its owner (`followPlacementRows`) — pass row roots by (`root.placement`). */
export const rootSource = <T extends { drawSource?: { node?: Object3D } }>(
  root: ClusterRoot<T>,
): Object3D | undefined =>
  root.pages[0]?.drawSource?.node ??
  root.placement?.rows.sources?.[root.placement.index] ??
  undefined

/** Whether a root hidden by its source still casts its shadow: its object says so (`castHiddenShadow`)
 *  and casts at all. The views do not draw it (`hiddenFromViews`); the shadow maps do. */
export const castsWhileHidden = (root: { mark?: number }) =>
  ((root.mark ?? 0) & (HIDDEN_SHADOW_ROOT | SHADOWLESS_ROOT)) === HIDDEN_SHADOW_ROOT

/** Root `root` (rank `rank`) parked as the one rule says — its source hidden and not casting while
 *  hidden, or its row parked —, `flip` hearing it when that flipped or when its shadow bit did
 *  (`cast`). The views hear it too (`views`): whether it is hidden and casts, and whether it stands for
 *  a first-person object. Whether it flipped. */
export function settleRoot<T>(
  root: ClusterRoot<T>,
  rank: number,
  flip?: (rank: number, root: ClusterRoot<T>) => void,
  cast = false,
  views?: ViewHidden,
) {
  views?.note(rank, root)
  const parked = (!!root.hidden && !castsWhileHidden(root)) || rowParked(root.placement),
    flipped = parked !== !!root.parked
  if (!flipped && !cast) return false
  root.parked = parked
  flip?.(rank, root)
  return flipped
}

/** The node a see-through draw comes from. */
export const blendSource = (item: { drawSource?: { node?: Object3D } }) => item.drawSource?.node

/** The entries to read of a list, `ranks[0 .. count)`: those under the nodes the host flipped. */
export type Subset = { readonly ranks: ArrayLike<number>; readonly count: number }

/**
 * Sets `hidden` on each entry from its source node's chain, and hands each entry that flipped to
 * `flipped`. Consecutive entries of one source share one walk.
 */
function followHidden<E extends { hidden?: boolean }>(
  entries: readonly E[],
  sourceOf: (entry: E) => Object3D | undefined,
  flipped: (entry: E, rank: number) => void,
  subset?: Subset,
) {
  let last: Object3D | undefined,
    lastHidden = false
  const ranks = subset?.ranks,
    count = subset ? subset.count : entries.length
  for (let k = 0; k < count; k++) {
    const rank = ranks ? ranks[k] : k,
      entry = entries[rank],
      source = sourceOf(entry)
    if (!source) continue
    if (source !== last) {
      last = source
      lastHidden = !rootedUnder(source, null, true)
    }
    if (lastHidden === !!entry.hidden) continue
    entry.hidden = lastHidden
    flipped(entry, rank)
  }
}

/**
 * Brings the roots and the see-through draws level with the visibility the host wrote on the
 * source graph. A root whose source node, or one of its ancestors, is hidden is parked as a parked
 * row is — every cut, the light cuts included, skips it, its tables stay —, and taken back once
 * shown again, unless its row is parked. A root placed at its own node's world casts as its mesh
 * says (`nodeCasting`, its marks); a row says for its own (`followPlacementRows`). `flip`
 * hears the rank of each root that flipped. A see-through draw of a hidden node takes `hidden`,
 * which its selection reads (`notDrawn`), and `seeThrough.flipped` hears it and its rank. Read once
 * per scene revision, never per frame. `under`, when given, names the roots and the see-through draws to read — those
 * under the nodes the host flipped —, the others standing as they are.
 */
export function followHostVisibility<
  T extends { drawSource?: { node?: Object3D } },
  S extends SeeThrough,
>(
  roots: readonly ClusterRoot<T>[],
  seeThrough: {
    entries: readonly S[]
    sourceOf: (entry: S) => Object3D | undefined
    flipped?: (entry: S, rank: number) => void
  },
  flip?: (rank: number, root: ClusterRoot<T>) => void,
  under?: { roots: Subset; seeThrough: Subset },
  views?: ViewHidden,
) {
  followHidden(
    roots,
    // A row root is hidden as its row is: its owner writes the row's flag (`followPlacementRows`).
    (root) => (root.placement ? undefined : rootSource(root)),
    (root, rank) => settleRoot(root, rank, flip, false, views),
    under?.roots,
  )
  const ranks = under?.roots.ranks,
    count = under ? under.roots.count : roots.length
  for (let k = 0; k < count; k++) {
    const rank = ranks ? ranks[k] : k,
      root = roots[rank],
      node = rootSource(root)
    if (root.placement || !node || !markCasting(root, nodeCasting(node))) continue
    // Its mark changed: it may now park or not while hidden.
    settleRoot(root, rank, flip, true, views)
  }
  followHidden(
    seeThrough.entries,
    seeThrough.sourceOf,
    (entry, rank) => seeThrough.flipped?.(entry, rank),
    under?.seeThrough,
  )
}
