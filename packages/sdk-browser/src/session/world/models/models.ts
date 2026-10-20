import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import { rootedUnder } from '../../../scene/host/world/rooted.ts'
import { updateTransformTree } from '../../../../../sdk-core/src/world/transform/pass.ts'
import type { Geometry } from '../../../../../sdk-core/src/world/geometry/geometry.ts'
import type { PageSurface } from '../../../geometry/pages/surface.ts'
import type { HostMesh } from '../../host/resources.ts'
import { meshes } from '../../../scene/meshes.ts'
import {
  drawSourceOf,
  type DrawRanks,
  type DrawSource,
} from '../../../geometry/selection/drawSource.ts'
import {
  createPlacementRows,
  growPlacementRows,
  writePlacementRow,
  type PlacementRows,
} from '../../../placement/rows/rows.ts'
import type { PlacementGrowth } from '../../../placement/engineSceneUpdates.ts'
import type { Primitive } from '../../../../../sdk-core/src/contracts/geometry.ts'
import { absolutePrimitive } from '../../../scene/absolutePrimitive.ts'
import { resolveCameraWorld } from '../../../camera/world.ts'
import { MATRIX_VALUES } from '../../../../../math/src/batch/strides.ts'
import { grownLength } from '../../../../../math/src/sequence/resized.ts'
import {
  modelPartitions,
  placementIndex,
  modelWorldRoots,
  type LoadedModel,
  type ModelRecord,
} from './loadedModel.ts'
import type { WorldRanks } from '../ranks.ts'

/** A placement's world times a mesh's, made here before its row takes it. */
const composed = new Float64Array(MATRIX_VALUES)

/**
 * One drawn mesh of a loaded model, drawn at one row per placement of the model (`placeModel`):
 * the mechanism the cells' placed meshes use (`geometry/partition/rows.ts`). Row `k` is placement `k`'s
 * world times the mesh's world inside its graph, which stands in its own frame: the graph hangs
 * from no node of the world (`PlacementRows.local`); the mesh itself stays every row's animation
 * source (`rows.sources`), so its skeleton — whose bones stand in that frame too —, morph weights
 * and waves reach the deformation as a placed resource's do. Each row is a root of its own, cut at
 * its own distance; every row draws the same pages.
 */
class ModelMeshSource implements DrawSource {
  rows: PlacementRows
  readonly mesh: number | undefined
  readonly primitives: number | undefined
  private readonly drawn: HostMesh
  constructor(drawn: HostMesh, ranks: DrawRanks) {
    this.drawn = drawn
    this.mesh = ranks.meshes
    this.primitives = ranks.primitives
    this.rows = createPlacementRows(1)
    this.rows.local = true
    this.rows.sources = [drawn]
    this.rows.sourceModels = new Set([drawn])
  }
  get geometry(): Geometry {
    return this.drawn.geometry
  }
  get attributes() {
    return this.drawn.geometry.attributes
  }
  get dynamic() {
    return this.drawn.geometry.usage === 'dynamic'
  }
  get declaration() {
    return this.drawn.material
  }
  get castShadow() {
    return this.drawn.castShadow
  }
  get frustumCulled() {
    return this.drawn.frustumCulled
  }
  wear(surface: PageSurface) {
    this.drawn.material = surface
  }
  /** The mesh's world within its graph: the local matrix the model's composition links its row by. */
  get local(): ArrayLike<number> {
    return this.drawn.matrixWorld.elements
  }
  /** A larger buffer of `capacity` rows, each new one parked and drawn from the same mesh. */
  grown(capacity: number) {
    const rows = growPlacementRows(this.rows, capacity)
    rows.sources = Array.from({ length: rows.capacity }, () => this.drawn)
    return rows
  }
  /** Writes row `row` from the mesh as its graph holds it: its placement's `world` times its own
   *  — unless the session composes it (`matrices` false) —, whether the placement is `shown` and
   *  the mesh and every node above it, whether it casts. */
  write(row: number, world: Float64Array, shown: boolean, matrices = true) {
    const { rows, drawn } = this
    if (matrices)
      rows.matrices.set(
        multiplyMatrix4(composed, world, drawn.matrixWorld.elements),
        row * MATRIX_VALUES,
      )
    writePlacementRow(rows, row, null, shown && rootedUnder(drawn, null, true), drawn.castShadow)
  }
}

/** The rows that pose the world DAG a model holds: one per placement of its record, each its
 *  placement's world and whether it is shown — a root of the DAG per row, as a mesh source's
 *  (`../../../geometry/hlod/worldRecords.ts`), grown with the record's sources (`grown`). */
type WorldPose = {
  readonly rows: PlacementRows
  write(row: number, world: Float64Array, shown: boolean, matrices?: boolean): void
}

/** The world DAG's rows, `capacity` of them, each new one parked until its placement writes it. */
class WorldPoseRows implements WorldPose {
  rows: PlacementRows
  constructor(capacity: number) {
    this.rows = createPlacementRows(capacity)
  }
  /** A larger buffer of `capacity` rows, each new one parked. */
  grown(capacity: number) {
    return growPlacementRows(this.rows, capacity)
  }
  write(row: number, world: Float64Array, shown: boolean, matrices = true) {
    writePlacementRow(this.rows, row, matrices ? world : null, shown, true)
  }
}

/** What a loaded model is drawn by — every placement of its record —: the sources of its drawn
 *  meshes, in its graph's order, and those among them it writes the rows of, one per placement. */
export type ModelDraws = {
  /** The first of the model's block of mesh ranks (`WorldRanks.model`). */
  readonly offset: number
  /** Its primitives with absolute addresses and their mesh ranks moved by `offset`: what the
   *  session's manifest lists of the model, made once. */
  readonly primitives: readonly Primitive[]
  readonly draws: readonly DrawSource[]
  readonly rowed: readonly (DrawSource & WorldPose & { readonly local: ArrayLike<number> })[]
  /** The poses of the world DAG the model holds, once the world draws it (`rootsOf`). */
  world?: WorldPose
}

/** A record's draws as its models hold them: the rows a placement grows — its sources' and its
 *  world DAG's poses' — and how many rows they hold, what the poses are made at. */
interface RecordDraws extends ModelDraws {
  readonly rowed: readonly ModelMeshSource[]
  world?: WorldPoseRows
  rowsHeld: number
}

/** The ranks of `model`'s association `link`, moved past the ranks before it. */
function moved(link: DrawRanks, offset: number): DrawRanks {
  const ranks: DrawRanks = { meshes: (link.meshes ?? 0) + offset, primitives: link.primitives }
  // Rows a partition's cells place are sized on the model's own link: read there, never copied.
  if (link.placements) Object.defineProperty(ranks, 'placements', { get: () => link.placements })
  return ranks
}

/** The draws of `record`, made once whatever the placements drawing it. */
function recordDraws(record: ModelRecord, ranks: WorldRanks): RecordDraws {
  const { metadata, scene } = record,
    links = scene.associations
  const offset = ranks.model(record, () => {
    // Past every rank its primitives and its meshes name: a mesh whose primitive the view has
    // not read yet keeps its rank from the next model's.
    let last = -1
    for (const { mesh } of metadata.primitives) last = Math.max(last, mesh)
    for (const link of links.values()) last = Math.max(last, link.meshes ?? -1)
    return last + 1
  })
  const all: DrawSource[] = [],
    rowed: ModelMeshSource[] = []
  for (const mesh of meshes(scene.source)) {
    const link = links.get(mesh)
    if (!link) all.push(drawSourceOf(mesh))
    else if (link.placements) all.push(drawSourceOf(mesh, moved(link, offset)))
    else {
      const source = new ModelMeshSource(mesh, moved(link, offset))
      all.push(source)
      rowed.push(source)
    }
  }
  let primitives: Primitive[] | undefined
  return {
    offset,
    get primitives() {
      return (primitives ??= metadata.primitives.map((primitive) => ({
        ...absolutePrimitive(primitive, record.base),
        mesh: primitive.mesh + offset,
      })))
    },
    draws: all,
    rowed,
    rowsHeld: 1,
  }
}

/**
 * THE MODELS OF A WORLD AS WHAT THEY DRAW. A model's graph holds meshes; each is a source drawn at
 * rows of its own — one per placement of the model, the row the model's load was read for first
 * (`placeModel`) — or at the rows the cells of a partition place it by, as the model's loader gave
 * them —, never a node of a graph the session reads. The sources are made once per record, with its
 * ranks, whatever number of placements draw it and sessions open on it: a second placement adds a
 * row to each source, never a primitive, a page, an image or a buffer. `pose` brings the graph to a
 * placement's world and writes its rows, of the models built alone.
 */
export function createWorldModels(ranks: WorldRanks) {
  const held = new WeakMap<ModelRecord, RecordDraws>()
  /** The placements each record's sources hold a row for. */
  const placed = new WeakSet<LoadedModel>()
  /** The rows of `draws` a placement grows: its sources', and its world DAG's poses. */
  const grownOf = (draws: RecordDraws) => [...draws.rowed, ...(draws.world ? [draws.world] : [])]
  /** `model`'s record's draws, `model` placed. */
  const drawsOf = (model: LoadedModel) => {
    models.place(model)
    return held.get(model.record)!
  }
  const models = {
    /**
     * Gives `model` its row in its record's sources — its rank among the record's placements
     * (`placementIndex`), the model its record was read for row 0 —, the sources made with the
     * record's first placement. A row past their buffers grows them, and the world DAG's poses with
     * them, each new row parked, in place under `grow` — the session holding them
     * (`PlacementGrowth`), which adds one root per new row —; the refusal by name when it does not
     * take them, nothing given.
     */
    place(model: LoadedModel, grow?: PlacementGrowth): string | undefined {
      if (placed.has(model)) return undefined
      const { record } = model
      let draws = held.get(record)
      if (!draws) held.set(record, (draws = recordDraws(record, ranks)))
      const row = placementIndex(model),
        needed = row + 1,
        sources = grownOf(draws),
        froms = sources.map((source) => source.rows)
      if (froms.some((rows) => rows.capacity < needed)) {
        const capacity = grownLength(Math.max(...froms.map((rows) => rows.capacity)), needed)
        if (grow && !grow.growsInPlace(froms, capacity))
          return `the session grows no row for another placement of ${record.manifestUrl}`
        for (const source of sources) {
          const from = source.rows
          if (from.capacity >= needed) continue
          source.rows = source.grown(capacity)
          grow?.growPlacements(from, source.rows)
        }
      }
      placed.add(model)
      draws.rowsHeld = Math.max(draws.rowsHeld, needed, ...sources.map((s) => s.rows.capacity))
      // Its partitions' scene hangs in this placement's world, which no node of theirs carries; its
      // rows draw the objects of this placement's instance of the world DAG.
      for (const cells of modelPartitions(model))
        cells.pose(() => resolveCameraWorld(model).worldMatrix as Float64Array, row)
      return undefined
    },
    drawsOf: drawsOf as (model: LoadedModel) => ModelDraws,
    /** `model`'s world roots: what the engine draws the world DAG from, one instance per placement
     *  of its record, each at its placement's world — the same holds for every placement. */
    rootsOf(model: LoadedModel) {
      const roots = modelWorldRoots(model),
        draws = drawsOf(model)
      // The world DAG of a model is drawn at each placement's world: a row each, written with its
      // meshes', as many as its sources hold.
      if (roots.some((hold) => hold.dag) && !draws.world)
        draws.world = new WorldPoseRows(draws.rowsHeld)
      for (const hold of roots) hold.drawnAs({ pose: draws.world })
      return roots
    },
    /** `model`'s graph brought up to date, and its rows — its placement's in each source — written
     *  from it, shown as `shown` says; cost: the meshes it draws, once for each move of the model
     *  or of one of its nodes. `composes`, asked once the graph is current, links the rows to the
     *  session's composition: then no matrix is written, the composition gives it where it is
     *  read. Without it, no session exists to compose them: the rows are written as the pose the
     *  session opens on. */
    pose(
      model: LoadedModel,
      shown: boolean,
      composes?: (draws: ModelDraws, row: number) => void,
    ): ModelDraws | undefined {
      if (!placed.has(model)) return undefined
      const draws = held.get(model.record)!,
        row = placementIndex(model)
      // The graph's worlds are its own, brought up to date where they changed.
      updateTransformTree(Object3D._treeOf(model.record.scene.source))
      const world = model.matrixWorld.elements,
        // A matrix is written only where no session exists to compose it: the pose it opens on.
        matrices = !composes
      composes?.(draws, row)
      for (const source of draws.rowed) source.write(row, world, shown, matrices)
      draws.world?.write(row, world, shown, matrices)
      return draws
    },
  }
  return models
}

/** The models of a world (`createWorldModels`). */
export type WorldModels = ReturnType<typeof createWorldModels>
