/**
 * THE ROWS THE PLACED CELLS OF A PARTITION HOLD: each node of a placed cell on a row of its
 * mesh (`rows.ts`), at the world matrix the engine composes for a child of its core parent, the row
 * knowing its cell and node while it holds them (`rowCells.ts`), the track of the scene's
 * animation banks it plays (`PlacementRows.tracks`), the distances it is drawn at
 * (`PlacementRows.drawDistance`), whether a view's primed depth draws it
 * (`PlacementRows.farField`), whether it casts far shadows (`Placement.farShadow`) and whether a
 * sun's far-shadow test reaches it (`Placement.farShadowTest`), both written into the row's casting
 * by `follow.ts`, and — a row drawn from an animated core
 * node's own mesh (`CellNode.source`) — that node's host mesh of its primitive as its animation
 * source (`PlacedMesh.sources`), shown while that mesh is. A cell that leaves parks its rows and
 * clears all three; a parent moved, a host mesh's `castShadow` changed, or a source mesh shown or
 * hidden, rewrites the rows under it (`follow.ts`). An HLOD cell's instanced actor places its rows
 * on the same meshes' rows while it is loaded, under the scene root (`placeActor`,
 * `../hlod/hlodRows.ts`). A cell placed or left, or whose rows draw as its HLOD 0 actor, moves the
 * source nodes the placed cells draw (`draws`), which the physics reads. What was written since the
 * last `touched.flush` is what the engine is told.
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { farTestOf, rootParentsByNode, type CellRows } from './cellDecode.ts'
import {
  rowColumn,
  seatDrawDistance,
  seatFarField,
  seatRootParent,
} from '../../placement/rows/rows.ts'
import { drawDistanceAt } from '../dag/drawDistance.ts'
import type { DrawDistance, RootParent } from '../selection/types.ts'
import { createPlacementWrites, type CellFrame, type Placement } from './follow.ts'
import {
  createTouchedRows,
  releaseRow,
  rowsFree,
  takeRow,
  type PlacedMesh,
  type StreamedMeshes,
} from './rows.ts'
import { rowCell, setRowCell, type RowCell } from './rowCells.ts'
import { createCellDraws } from './cellDraws.ts'

/** The source nodes of a cell that names none. */
const NO_SOURCES = new Uint32Array(0)

/** Row `row` of every link of `mesh` plays `track` of the scene's animation banks (-1: none), is
 *  drawn from `drawn` — a streamed core node's host meshes, by primitive —, from none when unset,
 *  is drawn at `distance` (none: at every distance), is a far-field row or not, and places an
 *  instance of an assembly whose root's group above each primitive is `parents` names, by
 *  primitive. The track column is made at the rows' capacity, every row -1, by the first row that
 *  plays one; the distances' by the first row that names one, the parents' by the first that names
 *  one. */
function seatRow(
  mesh: PlacedMesh,
  row: number,
  track: number,
  drawn?: readonly Mesh<object>[],
  distance?: DrawDistance,
  farField = false,
  parents?: ReadonlyMap<number, RootParent>,
) {
  mesh.links.forEach((link, at) => {
    const rows = link.placements!
    const tracks = track >= 0 ? rowColumn(rows, 'tracks') : rows.tracks
    if (tracks) tracks[row] = track
    seatDrawDistance(rows, row, distance)
    seatFarField(rows, row, farField)
    seatRootParent(rows, row, parents?.get(link.primitives ?? at))
    const column = mesh.sources?.[at]
    if (column) column[row] = drawn?.[at] ?? null
  })
}

/** What the row of node `node` of `cell` on `mesh` plays and is drawn from: its track, and —
 *  drawn from its core parent's own mesh (`sources`) — that parent's host meshes. A track the
 *  scene's banks do not hold, or a parent that streams no mesh, is refused by name. */
const rowSource = (
  cell: CellRows,
  node: number,
  mesh: PlacedMesh,
  url: string,
  streamed?: StreamedMeshes,
) => {
  const track = cell.tracks[node],
    parent = cell.ranks[2 * node],
    drawn = cell.sources[node] ? streamed?.get(parent) : undefined
  if (track >= 0 && !mesh.links[0]?.placements?.banks?.items[track])
    throw new EngineError(
      'PREPARED_SCENE_MISMATCH',
      `a scene cell plays item ${track} of animation banks the scene does not hold`,
      { cell: url, item: track },
    )
  if (cell.sources[node] && !drawn)
    throw new EngineError(
      'PREPARED_SCENE_MISMATCH',
      `a scene cell draws a row from core node ${parent}, which streams no mesh`,
      { cell: url, node: parent },
    )
  return { track, drawn }
}

/** What the placed cells keep: their rows, their actors' rows and the writers of both. */
interface CellPlacements {
  root: Object3D
  parents: readonly Object3D[]
  meshes: ReadonlyMap<number, PlacedMesh>
  streamed: StreamedMeshes | undefined
  held: Map<number, Placement[]>
  /** The rows of each HLOD cell's instanced actor placed (`placeActor`). */
  actors: Map<number, Placement[]>
  touched: ReturnType<typeof createTouchedRows>
  write: ReturnType<typeof createPlacementWrites>['write']
  settle: ReturnType<typeof createPlacementWrites>['settle']
  follow: ReturnType<typeof createPlacementWrites>['follow']
  /** The placed cells whose rows draw as their HLOD 0 actor, and the source nodes the others draw
   *  as themselves (`cellDraws.ts`). */
  draws: ReturnType<typeof createCellDraws>
}

/** Every row placed, a cell's or an actor's: what a parent's slot is made with. */
function* allRows(p: CellPlacements) {
  yield* p.held.values()
  yield* p.actors.values()
}

/** The row of node `node` of `decoded` taken on its mesh, placed under its parent, written and
 *  linked. */
function seatNode(
  p: CellPlacements,
  decoded: CellRows,
  url: string,
  node: number,
  instances: ReturnType<typeof rootParentsByNode>,
  at: (node: number) => RowCell,
) {
  const { ranks, locals, drawDistances, farFields, castFarShadows, farShadowTests } = decoded
  const parent = ranks[2 * node] < 0 ? p.root : p.parents[ranks[2 * node]]
  const mesh = p.meshes.get(ranks[2 * node + 1])!
  const local = locals.subarray(MATRIX_VALUES * node, MATRIX_VALUES * (node + 1))
  const { track, drawn } = rowSource(decoded, node, mesh, url, p.streamed)
  const farShadow = castFarShadows?.[node] === 1
  const farShadowTest = farTestOf(farShadowTests?.[node])
  const row = takeRow(mesh)
  const placement: Placement = {
    mesh,
    row,
    parent,
    local,
    ...(farShadow && { farShadow }),
    ...(farShadowTest !== undefined && { farShadowTest }),
  }
  // Before its flags are written: a row drawn from a source mesh is shown as that mesh is.
  const distance = drawDistanceAt(drawDistances, node)
  seatRow(mesh, row, track, drawn, distance, farFields?.[node] === 1, instances.get(node))
  for (const link of mesh.links) setRowCell(link.placements!, row, at(node))
  p.write(placement)
  return placement
}

/** Every node of `decoded`, read from `url`, on a row of its mesh, each row lying where `at`
 *  says, held in `into` under `key`, written and linked to its parent; false when a mesh is
 *  short. */
function seat(
  p: CellPlacements,
  [into, key]: readonly [Map<number, Placement[]>, number],
  decoded: CellRows,
  url: string,
  at: (node: number) => RowCell,
) {
  if (!rowsFree(p.meshes, decoded.ranks, url)) return false
  const instances = rootParentsByNode(decoded)
  const placements: Placement[] = [],
    { nodes } = decoded
  for (let node = 0; node < nodes; node++)
    placements.push(seatNode(p, decoded, url, node, instances, at))
  // Held before the parents' slots are made: a slot made now takes every row under it.
  into.set(key, placements)
  p.settle(
    allRows(p),
    placements.map((placement) => placement.parent),
  )
  return true
}

/** Parks `placements`' rows, their tracks, sources and distances cleared. */
function park(p: CellPlacements, placements: readonly Placement[]) {
  for (const { mesh, row } of placements) {
    releaseRow(mesh, row)
    seatRow(mesh, row, -1)
    for (const link of mesh.links) {
      setRowCell(link.placements!, row, undefined)
      p.touched.touch(link, row)
    }
  }
}

/** Places `cell`, whose file is `url` and whose HLOD 0 cell is `hlod`, from its decoded rows;
 *  false when a mesh is short. */
function placeCell(
  p: CellPlacements,
  draws: ReturnType<typeof createCellDraws>,
  instance: () => number,
  cell: number,
  decoded: CellRows,
  url: string,
  hlod: number,
) {
  const placed = seat(p, [p.held, cell], decoded, url, (node) => {
    return { cell, node, instance: instance(), hlod, proxy: false }
  })
  if (placed) draws.place(cell, decoded.sourceNodes ?? NO_SOURCES)
  return placed
}

/** The rows of `cell` drawn as its HLOD 0 actor or as the source meshes, rewritten only when that
 *  changed. */
function proxyCell(
  p: CellPlacements,
  draws: ReturnType<typeof createCellDraws>,
  cell: number,
  proxy: boolean,
) {
  const placements = p.held.get(cell)
  if (!placements || draws.proxied(cell) === proxy) return
  draws.proxy(cell, proxy)
  for (const { mesh, row } of placements)
    for (const link of mesh.links) {
      const at = rowCell(link.placements!, row)
      if (!at || at.proxy === proxy) continue
      setRowCell(link.placements!, row, { ...at, proxy })
      // Its page rows are written again with the colour of what draws (`linkWorldCell`).
      p.touched.touch(link, row)
    }
}

/** The state of the cells' rows: none held, the writers of the rows bound to `frame`. */
function createCellState(
  root: Object3D,
  parents: readonly Object3D[],
  meshes: ReadonlyMap<number, PlacedMesh>,
  frame: CellFrame,
  streamed?: StreamedMeshes,
): CellPlacements {
  const touched = createTouchedRows()
  const { write, follow, settle } = createPlacementWrites(touched, frame)
  return {
    root,
    parents,
    meshes,
    streamed,
    held: new Map<number, Placement[]>(),
    actors: new Map<number, Placement[]>(),
    touched,
    write,
    settle,
    follow,
    draws: createCellDraws(),
  }
}

/** The rows of the cells placed under `root` and the core `parents`, on the rows of `meshes`. */
export function createCellPlacements(
  root: Object3D,
  parents: readonly Object3D[],
  meshes: ReadonlyMap<number, PlacedMesh>,
  frame: CellFrame,
  /** The placement of its model the partition places cells for: the instance of the world DAG
   *  its rows' objects lie in (`rowCells.ts`). */
  instance: () => number,
  /** The host meshes each streamed core node draws: what a row drawn from it reads. */
  streamed?: StreamedMeshes,
) {
  const p = createCellState(root, parents, meshes, frame, streamed)
  const { held, actors, draws, touched, follow } = p
  return {
    /** The rows of each cell placed. */
    held: held as ReadonlyMap<number, readonly Placement[]>,
    /** The source nodes the placed cells draw as themselves. */
    draws,
    touched,
    /** Places `cell`, whose file is `url` and whose HLOD 0 cell is `hlod`, from its decoded rows;
     *  false when a mesh is short. */
    place: (cell: number, decoded: CellRows, url: string, hlod: number) =>
      placeCell(p, draws, instance, cell, decoded, url, hlod),
    /** Places the rows of HLOD cell `cell`'s instanced actor, of HLOD level `level` — the objects
     *  standing as themselves in it, each its mesh at its matrix under the scene root
     *  (`../hlod/hlodRows.ts`) —, each lying in that cell as its actor's (`RowCell.actor`): drawn
     *  while the cell draws its actor (`../dag/worlds/worldLinks.ts`, `ACTOR_ROW`); false when a
     *  mesh is short. */
    placeActor: (cell: number, level: number, decoded: CellRows) =>
      seat(p, [actors, cell], decoded, `HLOD cell ${cell}`, (node) => {
        return { cell: -1, node, instance: instance(), hlod: cell, proxy: true, actor: level }
      }),
    /** Parks the rows of HLOD cell `cell`'s actor, if placed. */
    leaveActor(cell: number) {
      const placements = actors.get(cell)
      if (!placements) return
      park(p, placements)
      actors.delete(cell)
    },
    /** The rows of `cell` draw as its HLOD 0 actor — `proxy`, its cell past the main grid's
     *  range — or as the source meshes (an instanced HLOD 0 is the same meshes, nothing rebuilt):
     *  rewritten only when that changed. */
    proxy: (cell: number, proxy: boolean) => proxyCell(p, draws, cell, proxy),
    /** Parks the rows of `cell`, their tracks, sources and distances cleared. */
    leave(cell: number) {
      park(p, held.get(cell)!)
      held.delete(cell)
      draws.leave(cell)
    },
    /** Rewrites the rows under every parent whose world moved since they were written, and those
     *  of a mesh whose host meshes' `castShadow` changed or one of whose source meshes was shown
     *  or hidden (`follow.ts`). */
    follow: () => follow(meshes.values(), allRows(p)),
  }
}
