import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { PlacementLink } from '../../placement/gpuCompose.ts'
import type { PlacementRows } from '../../placement/rows.ts'
import type { Seat } from './worldBatches.ts'
import type { WorldModels } from './worldModels.ts'
import { extendSpan } from '../../../../math/src/sequence/span.ts'

/** Rows a session composes on the GPU under their parent (`placement/gpuCompose.ts`). */
export type PoseComposer = {
  /** The session: another one holds no link. */
  key: object
  /** The seat epoch: a seat that may have changed drops every link. */
  epoch: number
  /**
   * `parent`'s world is `world`, and rows `links` follow it, each at its local matrix — views read
   * during the call, never kept. `whole`: they are every row that follows it, any other it held is
   * the CPU's again — none at all unlinks it, its world unread —; otherwise they are children that
   * moved on their own under a parent it holds.
   */
  link(
    parent: object,
    world: ArrayLike<number>,
    links: readonly PlacementLink[],
    whole: boolean,
  ): void
}

/** No links, no world: an unlink, or a parent's world sent alone. */
export const NONE: readonly never[] = []

/** Whoever owns rows the world writes: a batch, or a model's mesh. */
export type RowsOwner = { readonly rows?: PlacementRows | null }

/** What a world's change list holds between two frames (`createWorldPoses`). */
export type PoseState = {
  /** The nodes whose pose or visibility moved since the last frame. */
  moved: Set<Object3D>
  /** The rows written since the last frame, per batch. */
  ranges: Map<RowsOwner, { rows: PlacementRows; from: number; to: number }>
  /** Parents whose children the session composes, and whether each parent was drawn. */
  composed: Map<Object3D, boolean>
  /** Parents taken out of `composed` during an `apply`: unlinked at its end unless linked again. */
  dropped: Set<Object3D>
  /** The children of each composed parent that moved on their own, gathered by `apply`. */
  movedUnder: Map<Object3D, Object3D[]>
  composedKey: object | undefined
  composedEpoch: number
}

/** What one `apply` writes the moved subtrees with: the seats, the models, the session's composer. */
export type PoseFrame = {
  seats: ReadonlyMap<Mesh, Seat>
  models: WorldModels
  composer: PoseComposer | undefined
}

/** Rows `from`..`to` of a batch were written: the range sent before the next frame grows. */
export function touchRows({ ranges }: PoseState, owner: RowsOwner, from: number, to: number) {
  if (!owner.rows) return
  const range = ranges.get(owner)
  if (range && range.rows === owner.rows) extendSpan(range, from, to)
  else ranges.set(owner, { rows: owner.rows, from, to })
}
