import type { ClusterRoot, PageRec } from '../geometry/selection/types.ts'

import { createDeformationFrame, type DeformedMesh } from './frame.ts'
import { placementDeformation } from './placementSource.ts'
import { deformedOf } from './source.ts'
import type { MatrixElements } from '../session/host/matrixElements.ts'
import { rekeyRebound } from '../placement/growth/growth.ts'
import { createRowsAnimate, rootHasOutputs, unsourced } from './outputs.ts'
import { createBankTracks } from './bankTracks.ts'
import { createRootTracks } from './rootTracks.ts'

type Capacities = Parameters<typeof placementDeformation>[2]

/** What moves the pages `owner` draws (`placementDeformation`): the node drawing them, or the
 *  sources and tracks of the rows placing them; none for a source drawn at rows holding neither. */
function movedBy(owner: ClusterRoot<PageRec>, capacities: Capacities) {
  const draw = owner.pages[0]?.drawSource,
    rows = draw?.rows
  const source: DeformedMesh | undefined =
    draw?.node ?? (rows?.sources || rows?.banks ? {} : undefined)
  return source && placementDeformation(owner, source, capacities)
}

/** The record `owner` takes of its own (`deformedOf`), or `null`. A source drawn at rows is moved
 *  by the owners of its rows, none by a node of its own; rows whose sources can never be one
 *  (`unsourced`) take none. */
function recordOf(owner: ClusterRoot<PageRec>, capacities: Capacities) {
  if (unsourced(owner.placement?.rows)) return null
  const moved = movedBy(owner, capacities)
  return moved ? deformedOf(moved.mesh, owner, owner.world, moved.capacity) : null
}

/**
 * Whether `roots` give the deformation work: a bank's track to play (`createRootTracks`), a
 * record (`recordOf`) or a page's results (`rootHasOutputs`). The one rule that loads the stage's
 * code, at the open as at a growth (`loadDeformationCode`); its compute is made wherever the code
 * is.
 */
export function deformsAny(roots: readonly ClusterRoot<PageRec>[]) {
  const capacities: Capacities = new Map()
  const rowsAnimate = createRowsAnimate(),
    playable = createRootTracks()
  return roots.some(
    (root) =>
      playable(root).length > 0 ||
      rootHasOutputs(root, rowsAnimate) ||
      !!recordOf(root, capacities),
  )
}

/** What a session's deformation keeps by rank (`createSessionDeformation`). */
type Held = {
  capacities: Capacities
  frame: ReturnType<typeof createDeformationFrame>
  tracks: ReturnType<typeof createBankTracks>
  /** The record of each root by its rank. */
  rankEntry: number[]
  /** Each root's rank by the world it reads: what a transparent item knows it by. */
  byWorld: Map<object, number>
}

/** The placements `added` join the records, behind the tracks of the banks they name. */
function appendRoots(held: Held, added: readonly ClusterRoot<PageRec>[]) {
  const { capacities, frame, tracks, rankEntry, byWorld } = held
  const playable = createRootTracks(),
    rowsAnimate = createRowsAnimate()
  const plays = added.map(playable)
  for (const named of plays) for (const track of named) tracks.join(track.banks)
  const own = (root: ClusterRoot<PageRec>, k: number) =>
    plays[k].length && !rowsAnimate(root.placement?.rows) ? null : recordOf(root, capacities)
  const first = frame.append(added.map(own))
  added.forEach((root, k) => {
    const rank = rankEntry.length
    rankEntry.push(first + k)
    byWorld.set(root.world, rank)
    const moved = plays[k].length ? movedBy(root, capacities) : undefined
    if (moved) tracks.add(rank, root, moved.mesh, first + k)
  })
}

/**
 * A session's GPU deformation: one record per deformed root of its cut (`frame.ts`) and one per
 * track of the animation banks its roots name (`bankTracks.ts`), the block of records placed in
 * the float pool the page passes bind (`place`), and the word a row carries to name the record it
 * reads (`PageInfo.deform`): its root's own, or, for a root playing a bank's track, the track's
 * while it animates and none while it rests. Roots joining the session later take records behind
 * the others' (`append`), at the rank the cut gives them, the tracks of the banks they name before
 * theirs: a root's rank names its own record through `entryOf`, the word its rows carry through
 * `rowWord`, a transparent item's world through `wordOfWorld`. A root playing a bank's tracks
 * alone — no source of its rows moving it (`createRowsAnimate`) — takes no record of its own.
 */
export function createSessionDeformation(roots: readonly ClusterRoot<PageRec>[] = []) {
  let base = 0
  const frame = createDeformationFrame()
  const held: Held = {
    ...{ capacities: new Map(), frame, tracks: createBankTracks(frame) },
    ...{ rankEntry: [], byWorld: new Map() },
  }
  const { tracks, rankEntry, byWorld } = held
  const append = (added: readonly ClusterRoot<PageRec>[]) => appendRoots(held, added)
  append(roots)
  /** What the rows of root `rank` carry (`rowWord`). */
  const wordOf = (rank: number) => {
    const at = frame.bases[tracks.named(rank) ?? rankEntry[rank]] ?? 0
    return at ? base + at : 0
  }
  /** The placements whose world was `old` stand on `world` now (a growth of their rows): their
   *  records follow, found by the new view as the old. */
  const rebind = (rebound: ReadonlyMap<MatrixElements, MatrixElements>) =>
    rekeyRebound(byWorld, rebound, (rank, world) => frame.rebind(rankEntry[rank], world))
  return {
    frame,
    tracks,
    append,
    rebind,
    /** The roots the session holds records for: the rank the next one joins at. */
    get ranks() {
      return rankEntry.length
    },
    /** The record of the root at `rank`, -1 for a rank the session holds none of. */
    entryOf: (rank: number) => rankEntry[rank] ?? -1,
    /** Frame `tick`'s records (`frame.update`): every one deforms. Returns whether a record
     *  moved. */
    update: (tick: number) => frame.update(tick),
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
    /** What a row of `placement` carries: the first float in the pool plus one of the record it
     *  reads (`tracks.named`, else its root's own), zero when it reads none. */
    rowWord: (placement: number | undefined) => (placement === undefined ? 0 : wordOf(placement)),
    /** `rowWord` of the root placed by `world`: a transparent item's. */
    wordOfWorld(world: object) {
      const rank = byWorld.get(world)
      return rank === undefined ? 0 : wordOf(rank)
    },
  }
}

export type SessionDeformation = ReturnType<typeof createSessionDeformation>
