import { BOX_VALUES, boxEmpty, boxIsEmpty, boxUnionBatch } from '../../../sdk-core/src/index.ts'
import type { ClusterRoot } from '../page/selection/types.ts'
import { rowParked, type PlacementOf } from './rows.ts'
import { markShadowless } from '../visibility/shader/spriteWgsl.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

/** A see-through draw — a blend item — as visibility reads it:
 *  hidden with its source node, parked with its row. */
export type SeeThrough = { hidden?: boolean; readonly placement?: PlacementOf }

/** True when `entry` is not drawn: its source node is hidden, or its row parked. */
export const notDrawn = (entry: SeeThrough) => !!entry.hidden || rowParked(entry.placement)

/** The node a root comes from: its first page's mesh. */
export const rootSource = <T extends { sourceMesh?: Object3D }>(root: ClusterRoot<T>) =>
  root.pages[0]?.sourceMesh

/** The node a see-through draw comes from. */
export const blendSource = (item: { sourceMesh?: unknown }) =>
  item.sourceMesh as Object3D | undefined

/** True when `node` and every node above it are visible. */
export function shownChain(node: Object3D) {
  for (let walk: Object3D | null = node; walk; walk = walk.parent) if (!walk.visible) return false
  return true
}

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
      lastHidden = !shownChain(source)
    }
    if (lastHidden === !!entry.hidden) continue
    entry.hidden = lastHidden
    flipped(entry, rank)
  }
}

/** The box the roots that flipped cover, as one union, and its two corners. */
const moved = new Float64Array(BOX_VALUES),
  movedMin = moved.subarray(0, 3),
  movedMax = moved.subarray(3, 6)

/**
 * Brings the roots and the see-through draws level with the visibility the host wrote on the
 * source graph. A root whose source node, or one of its ancestors, is hidden is parked as a parked
 * row is — every cut, the light cuts included, skips it, its tables stay —, and taken back once
 * shown again, unless its row is parked. A root placed at its own node's world casts as its mesh
 * says (`castShadow`, its shadowless bit); a row says for its own (`followPlacementRows`). `flip`
 * hears the rank of each root that flipped. A see-through draw of a hidden node takes `hidden`,
 * which its selection reads (`notDrawn`), and `seeThrough.flipped` hears it. Read once per scene
 * revision, never per frame. Returns the box of the roots that flipped, where the shadow pages must
 * be drawn again, or `null`; its corners are views of one scratch box, read before the next call.
 * `movingOnly` says every root that flipped `moves` already: the static casters under it stay.
 * `under`, when given, names the roots and the see-through draws to read — those under the nodes
 * the host flipped —, the others standing as they are.
 */
export function followHostVisibility<T extends { sourceMesh?: Object3D }, S extends SeeThrough>(
  roots: readonly ClusterRoot<T>[],
  seeThrough: {
    entries: readonly S[]
    sourceOf: (entry: S) => Object3D | undefined
    flipped?: (entry: S) => void
  },
  flip?: (rank: number, root: ClusterRoot<T>) => void,
  moves?: (rank: number) => boolean,
  under?: { roots: Subset; seeThrough: Subset },
) {
  boxEmpty(moved, 0)
  let movingOnly = true
  const flipped = (rank: number, root: ClusterRoot<T>) => {
    movingOnly &&= !!moves?.(rank)
    flip?.(rank, root)
  }
  followHidden(
    roots,
    rootSource,
    (root, rank) => {
      const parked = !!root.hidden || rowParked(root.placement)
      if (parked === !!root.parked) return
      root.parked = parked
      flipped(rank, root)
      if (root.worldBox) boxUnionBatch(moved, root.worldBox, 1)
    },
    under?.roots,
  )
  const ranks = under?.roots.ranks,
    count = under ? under.roots.count : roots.length
  for (let k = 0; k < count; k++) {
    const rank = ranks ? ranks[k] : k,
      root = roots[rank],
      source = rootSource(root)
    if (root.placement || !source || !markShadowless(root, !source.castShadow)) continue
    flipped(rank, root)
    if (root.worldBox && !root.parked) boxUnionBatch(moved, root.worldBox, 1)
  }
  followHidden(
    seeThrough.entries,
    seeThrough.sourceOf,
    (entry) => seeThrough.flipped?.(entry),
    under?.seeThrough,
  )
  return boxIsEmpty(moved, 0) ? null : { min: movedMin, max: movedMax, movingOnly }
}
