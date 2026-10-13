import type { BlendCopy } from '../cluster/blendCopyContract.ts'
import type { ClusterRoot } from '../page/selection/types.ts'
import type { PageRec } from '../page/selection/selection.ts'
import type { DrawSource } from '../page/selection/drawSource.ts'
import { createDeformationFrame, type DeformedMesh } from './frame.ts'
import { placementDeformation } from './placementSource.ts'
import { deformedOf } from './source.ts'
import type { MatrixElements } from '../host/matrixElements.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { createDeformationSkip } from './screen.ts'

/**
 * A session's GPU deformation: one record per deformed root of its cut (`frame.ts`), the
 * block of records placed in the float pool the page passes bind (`place`), and the word a row
 * carries to name its root's record (`PageInfo.deform`). Roots and blended copies joining the
 * session later take records behind the others' (`append`), at the rank the cut gives them: a
 * root's rank names its record through `entryOf`, a copy's world through `wordOfWorld`.
 */
export function createSessionDeformation(
  roots: readonly ClusterRoot<PageRec>[],
  copies: readonly BlendCopy[] = [],
) {
  const capacities: Parameters<typeof placementDeformation>[2] = new Map()
  const deformedEntry = (
    draw: DrawSource | undefined,
    owner: ClusterRoot<PageRec> | BlendCopy,
    world: MatrixElements,
  ) => {
    // A source drawn at rows is moved by the owners of its rows, none by a node of its own.
    const source: DeformedMesh | undefined = draw?.node ?? (draw?.rows?.sources ? {} : undefined)
    if (!source) return null
    const { mesh, capacity } = placementDeformation(owner.placement, source, capacities)
    return deformedOf(mesh, owner, world, capacity)
  }
  let base = 0
  const frame = createDeformationFrame()
  /** The record of each root by its rank, and the root each record belongs to (a copy's has none). */
  const rankEntry: number[] = []
  const entryRoot: (ClusterRoot<PageRec> | undefined)[] = []
  /** Each root's, and each copy's, record by the world it reads: what a transparent item knows it by. */
  const byWorld = new Map<object, number>()
  /** The placements `added` join the records: roots first, then copies. */
  const append = (
    added: readonly ClusterRoot<PageRec>[],
    addedCopies: readonly BlendCopy[] = [],
  ) => {
    const first = frame.append([
      ...added.map((root) => deformedEntry(root.pages[0]?.drawSource, root, root.world)),
      ...addedCopies.map((copy) => deformedEntry(copy.userData.drawSource, copy, copy.matrix)),
    ])
    added.forEach((root, k) => {
      rankEntry.push(first + k)
      entryRoot[first + k] = root
      byWorld.set(root.world, first + k)
    })
    addedCopies.forEach((copy, k) => byWorld.set(copy.matrix, first + added.length + k))
  }
  append(roots, copies)
  const rankOf = (world: object) => byWorld.get(world) ?? -1
  /** The placements whose world was `old` stand on `world` now (a growth of their rows): their
   *  records follow, found by the new view as the old. */
  const rebind = (rebound: ReadonlyMap<MatrixElements, MatrixElements>) => {
    for (const [old, world] of rebound) {
      const entry = byWorld.get(old)
      if (entry === undefined) continue
      byWorld.delete(old)
      byWorld.set(world, entry)
      frame.rebind(entry, world)
    }
  }
  const skip = createDeformationSkip()
  return {
    frame,
    append,
    rebind,
    /** The roots the session holds records for: the rank the next one joins at. */
    get ranks() {
      return rankEntry.length
    },
    /** The record of the root at `rank`, -1 for a rank the session holds none of. */
    entryOf: (rank: number) => rankEntry[rank] ?? -1,
    /** Frame `tick`'s records (`frame.update`), a root whose reach spans less than `pixelError`
     *  drawn at rest (`screen.ts`). Returns whether a record moved. */
    update(
      cam: EngineCamera,
      viewport: readonly number[] | undefined,
      pixelError: number,
      tick: number,
    ) {
      return frame.update(skip(entryRoot, cam, viewport, pixelError), tick)
    },
    changedOfWorld(world: object) {
      return frame.dirty[rankOf(world)] === 1
    },
    reachOfWorld(world: object) {
      return frame.reach[rankOf(world)] ?? 0
    },
    /** Whether any root deforms. */
    get any() {
      return frame.deforming > 0
    },
    /** Floats the float pool keeps after its vertices for the block: the room the records have. */
    get floats() {
      return frame.block.length
    },
    /** The block lies from float `offset` of the pool. */
    place(offset: number) {
      base = offset
    },
    /** The block's first float in the pool. */
    get base() {
      return base
    },
    /** What a row of `placement` carries: its record's first float in the pool plus one, zero
     *  when it has none. */
    rowWord(placement: number | undefined) {
      const at = placement === undefined ? 0 : (frame.bases[rankEntry[placement]] ?? 0)
      return at ? base + at : 0
    },
    /** `rowWord` of the root placed by `world`: a transparent item's. */
    wordOfWorld(world: object) {
      const at = frame.bases[rankOf(world)] ?? 0
      return at ? base + at : 0
    },
  }
}

export type SessionDeformation = ReturnType<typeof createSessionDeformation>
