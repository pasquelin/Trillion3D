import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { updateTransformTree } from '../../../../sdk-core/src/world/transform-tree/pass.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { GraphSurface } from '../../host/graph/surface.ts'
import type { HostMesh } from '../../host/resources.ts'
import { objects } from '../../page/selection/helpers.ts'
import { drawSourceOf, type DrawRanks, type DrawSource } from '../../page/selection/drawSource.ts'
import { createPlacementRows, type PlacementRows } from '../../placement/rows.ts'
import type { Primitive } from '../../../../sdk-core/src/index.ts'
import { absolutePrimitive } from '../../scene/absolutePrimitive.ts'
import { resolveCameraWorld } from '../../camera/world.ts'
import { modelWorldRoots, type LoadedModel } from './loadedModel.ts'
import type { WorldRanks } from './worldRanks.ts'

/**
 * One drawn mesh of a loaded model, drawn at one row: a buffer of capacity one, the mechanism
 * the cells' placed meshes use (`partition/rows.ts`). The row is the model's world times the mesh's
 * world inside its graph, which stands in its own frame: the graph hangs from no node of the world
 * (`PlacementRows.local`); the mesh itself stays the row's animation source (`rows.sources`), so
 * its skeleton — whose bones stand in that frame too —, morph weights and waves reach the
 * deformation as a placed resource's do.
 */
class ModelMeshSource implements DrawSource {
  readonly rows: PlacementRows
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
  wear(surface: GraphSurface) {
    this.drawn.material = surface
  }
  /** Writes the row from the mesh as its graph holds it: the model's `world` times its own, whether
   *  the model is `shown` and the mesh and every node above it, whether it casts. */
  write(world: Float64Array, shown: boolean) {
    const { rows, drawn } = this
    multiplyMatrix4(rows.matrices, world, drawn.matrixWorld.elements)
    let live = shown
    for (let walk: Object3D | null = drawn; live && walk; walk = walk.parent) live = walk.visible
    rows.live[0] = live ? 1 : 0
    rows.shadowless[0] = drawn.castShadow ? 0 : 1
  }
}

/** The row that poses the world DAG a model holds: the model's world, and whether it is shown. */
export type WorldPose = {
  readonly rows: PlacementRows
  write(world: Float64Array, shown: boolean): void
}

function createWorldPose(): WorldPose {
  const rows = createPlacementRows(1)
  return {
    rows,
    write(world, shown) {
      rows.matrices.set(world)
      rows.live[0] = shown ? 1 : 0
    },
  }
}

/** What a loaded model is drawn by: the sources of its drawn meshes, in its graph's order, and
 *  those among them it writes the row of. */
export type ModelDraws = {
  /** The first of the model's block of mesh ranks (`WorldRanks.model`). */
  readonly offset: number
  /** Its primitives with absolute addresses and their mesh ranks moved by `offset`: what the
   *  session's manifest lists of the model, made once. */
  readonly primitives: readonly Primitive[]
  readonly draws: readonly DrawSource[]
  readonly rowed: readonly (DrawSource & {
    readonly rows: PlacementRows
    write(world: Float64Array, shown: boolean): void
  })[]
  /** The pose of the world DAG the model holds, once the world draws it (`rootsOf`). */
  world?: WorldPose
}

/** The ranks of `model`'s association `link`, moved past the ranks before it. */
function moved(link: DrawRanks, offset: number): DrawRanks {
  const ranks: DrawRanks = { meshes: (link.meshes ?? 0) + offset, primitives: link.primitives }
  // Rows a partition's cells place are sized on the model's own link: read there, never copied.
  if (link.placements) Object.defineProperty(ranks, 'placements', { get: () => link.placements })
  return ranks
}

/**
 * THE MODELS OF A WORLD AS WHAT THEY DRAW. A model's graph holds meshes; each is a source drawn at
 * a row of its own — or at the rows the cells of a partition place it by, as the model's loader
 * gave them —, never a node of a graph the session reads. The sources are made once with the
 * model and its ranks, whatever number of sessions open on it. `pose` brings the graph to the model's
 * world and writes the rows, of the models built alone.
 */
export function createWorldModels(ranks: WorldRanks) {
  const held = new WeakMap<LoadedModel, ModelDraws>()
  return {
    drawsOf(model: LoadedModel): ModelDraws {
      let draws = held.get(model)
      if (draws) return draws
      const { metadata, scene } = model.record,
        links = scene.associations
      const offset = ranks.model(model, () => {
        // Past every rank its primitives and its meshes name: a mesh whose primitive the view has
        // not read yet keeps its rank from the next model's.
        let last = -1
        for (const { mesh } of metadata.primitives) last = Math.max(last, mesh)
        for (const link of links.values()) last = Math.max(last, link.meshes ?? -1)
        return last + 1
      })
      const all: DrawSource[] = [],
        rowed: ModelDraws['rowed'][number][] = []
      for (const mesh of objects(scene.source)) {
        const link = links.get(mesh)
        if (!link) all.push(drawSourceOf(mesh))
        else if (link.placements) all.push(drawSourceOf(mesh, moved(link, offset)))
        else {
          const source = new ModelMeshSource(mesh, moved(link, offset))
          all.push(source)
          rowed.push(source)
        }
      }
      // Its partitions' scene hangs in the model's world, which no node of theirs carries.
      for (const cells of scene.partitions ?? [])
        cells.pose(() => resolveCameraWorld(model).worldMatrix as Float64Array)
      let primitives: Primitive[] | undefined
      held.set(
        model,
        (draws = {
          offset,
          get primitives() {
            return (primitives ??= metadata.primitives.map((primitive) => ({
              ...absolutePrimitive(primitive, model.record.base),
              mesh: primitive.mesh + offset,
            })))
          },
          draws: all,
          rowed,
        }),
      )
      return draws
    },
    /** `model`'s world roots, their tables naming its primitives as the merged manifest ranks them
     *  (`WorldRootsHold.rank`): what the engine draws the world DAG from. */
    rootsOf(model: LoadedModel) {
      const roots = modelWorldRoots(model),
        draws = this.drawsOf(model)
      // The world DAG of a model is drawn at the model's world: one row, written with its meshes'.
      if (roots.some((hold) => hold.drawn) && !draws.world) draws.world = createWorldPose()
      for (const hold of roots)
        hold.drawnAs({ primitives: draws.primitives, pose: draws.world?.rows })
      return roots
    },
    /** `model`'s graph put at the model's world, shown as `shown` says, and the rows of its
     *  meshes written from it; cost: the meshes it draws, once for each move of the model or of
     *  one of its nodes. */
    pose(model: LoadedModel, shown: boolean) {
      const draws = held.get(model)
      if (!draws) return undefined
      // The graph's worlds are its own, brought up to date where they changed.
      updateTransformTree(Object3D._treeOf(model.record.scene.source))
      const world = model.matrixWorld.elements
      for (const source of draws.rowed) source.write(world, shown)
      draws.world?.write(model.matrixWorld.elements, shown)
      return draws
    },
  }
}

/** The models of a world (`createWorldModels`). */
export type WorldModels = ReturnType<typeof createWorldModels>
