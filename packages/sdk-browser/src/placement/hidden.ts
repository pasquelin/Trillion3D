import type { ClusterRoot } from '../page/selection/types.ts'
import { rowParked, type PlacementOf } from './rows.ts'
import { markShadowless } from '../visibility/shader/spriteWgsl.ts'
import { rootedUnder } from '../host/world/rooted.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

/** A see-through draw — a blend item — as visibility reads it:
 *  hidden with its source node, parked with its row. */
export type SeeThrough = { hidden?: boolean; readonly placement?: PlacementOf }

/** True when `entry` is not drawn: its source node is hidden, or its row parked. */
export const notDrawn = (entry: SeeThrough) => !!entry.hidden || rowParked(entry.placement)

/** The node a root comes from: its first page's mesh. */
export const rootSource = <T extends { drawSource?: { node?: Object3D } }>(root: ClusterRoot<T>) =>
  root.pages[0]?.drawSource?.node

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
 * says (`castShadow`, its shadowless bit); a row says for its own (`followPlacementRows`). `flip`
 * hears the rank of each root that flipped: its rows, derived again, stale the shadow pages it left
 * or entered (`rowCastWgsl.ts`). A see-through draw of a hidden node takes `hidden`, which its
 * selection reads (`notDrawn`), and `seeThrough.flipped` hears it and its rank. Read once per scene revision,
 * never per frame. `under`, when given, names the roots and the see-through draws to read — those
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
) {
  followHidden(
    roots,
    rootSource,
    (root, rank) => {
      const parked = !!root.hidden || rowParked(root.placement)
      if (parked === !!root.parked) return
      root.parked = parked
      flip?.(rank, root)
    },
    under?.roots,
  )
  const ranks = under?.roots.ranks,
    count = under ? under.roots.count : roots.length
  for (let k = 0; k < count; k++) {
    const rank = ranks ? ranks[k] : k,
      root = roots[rank],
      node = rootSource(root)
    if (root.placement || !node || !markShadowless(root, !node.castShadow)) continue
    flip?.(rank, root)
  }
  followHidden(
    seeThrough.entries,
    seeThrough.sourceOf,
    (entry, rank) => seeThrough.flipped?.(entry, rank),
    under?.seeThrough,
  )
}
