import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { PlacementGrowth } from '../../placement/engineSceneUpdates.ts'
import type { PartitionCells } from '../../partition/cells.ts'
import type { WorldRootsHold } from '../../scene/worldRoots.ts'
import { primitiveFinder } from '../../scene/primitiveLookup.ts'
import type { LoadedModel } from './loadedModel.ts'
import type { WorldModels } from './worldModels.ts'
import { shownUnder, type createWorldPoses } from './worldPoses.ts'

/** What a running session lends the models joining it: the engine's growth, and the partitions it
 *  follows (`world/api/sceneApi.ts`). */
export type ModelSession = PlacementGrowth & {
  preparePartitions?(
    cells: readonly PartitionCells[],
    roots: readonly WorldRootsHold[],
  ): Promise<void>
  followPartitions?(cells: readonly PartitionCells[]): void
  leavePartitions?(cells: readonly PartitionCells[]): void
}

/** Where a model stands in the session: being joined, refused by it, or held — drawn (`shown`),
 *  or parked (it left the scene: its rows are down and its cells let go). */
type Held = { state: 'joining' | 'refused' | 'parked' | 'shown' }

type Inputs = {
  scene: Object3D
  models: WorldModels
  poses: ReturnType<typeof createWorldPoses>
  /** Told, by name, what the session does not take. */
  refused: (what: string, reason: string) => void
}

/**
 * THE MODELS OF A WORLD AND ITS RUNNING SESSION. A model the scene gained joins the session by the
 * functions the open runs on its content: its primitives enter the manifest, its meshes — each a
 * source with rows — are handed to the engine one after the other (`PlacementGrowth.addPlacements`,
 * the function a batch joins by), its partitions are placed for the view and followed from then on
 * (`ModelSession.preparePartitions`, `followPartitions`: the pages catalogued, the roots bound, the
 * first cells placed, as the open does), its world DAG is drawn once its sources are
 * (`PlacementGrowth.addWorldRoots`). A model the scene lost keeps its place: its rows are
 * parked and its cells let go, and it draws again where the scene takes it back. The session is
 * never opened again for a model.
 *
 * Cost of a model of P primitives and C meshes: the open's cost of its content, once — the
 * engine's, per source; the first view's cells, read and placed; nothing of the models already
 * held. A model that leaves or returns: its C rows written, its cells let go or placed anew.
 */
export function createModelJoins({ scene, models, poses, refused }: Inputs) {
  const held = new Map<LoadedModel, Held>()
  /** The joins in flight. */
  const flights = new Set<Promise<void>>()
  /** The model's rows written from the model as it stands. */
  const write = (model: LoadedModel) => {
    model.updateWorldMatrix(true, false)
    poses.writeModel(models, model, shownUnder(model, scene))
  }
  /** Parks `model`, which the scene lost — rows down, cells given back —, or draws it again, the
   *  scene took it back. */
  const setParked = (model: LoadedModel, entry: Held, session: ModelSession, parked: boolean) => {
    const { partitions } = model.record.scene
    entry.state = parked ? 'parked' : 'shown'
    write(model)
    if (!partitions.length) return
    if (parked) session.leavePartitions?.(partitions)
    else session.followPartitions?.(partitions)
  }
  /** Why `model` cannot be handed to the session, if it cannot. */
  const unfit = (model: LoadedModel, session: ModelSession) =>
    !session.addPlacements
      ? 'the session takes no source in place'
      : model.record.scene.partitions.length && !session.preparePartitions
        ? 'the session follows no partition added to it'
        : model.record.textureSource === 'cache'
          ? 'its images were left to the cache, whose levels only the model the session is based on reads'
          : undefined
  /** Hands the model's content to the session: its cells first, then each source. */
  async function join(
    model: LoadedModel,
    entry: Held,
    session: ModelSession,
    members: ReadonlySet<LoadedModel>,
  ) {
    const { primitives, draws } = models.drawsOf(model),
      partitions = model.record.scene.partitions
    const refuse = (reason: string) => {
      if (held.get(model) !== entry) return // a session opened meanwhile holds the model by its open
      entry.state = 'refused'
      refused(`the model ${model.record.manifestUrl}`, reason)
    }
    const why = unfit(model, session)
    if (why) return void refuse(why)
    const roots = models.rootsOf(model) // its world DAG's pose is written with its meshes'
    write(model)
    const find = primitiveFinder(primitives)
    try {
      if (partitions.length) await session.preparePartitions!(partitions, roots)
      for (const source of draws) {
        const primitive = find({ meshes: source.mesh, primitives: source.primitives })
        const reason = !primitive
          ? `no primitive for mesh ${source.mesh}/${source.primitives ?? 0}`
          : await session.addPlacements!(source, primitive)
        if (reason) return void refuse(reason)
      }
      // Its world DAG, once its sources wear its pages: the session draws it by the cut made over
      // every root. Refused, the cells are drawn by their objects alone, and it is said.
      for (const hold of roots) {
        const reason = await session.addWorldRoots?.(hold)
        if (reason) refused(`the world DAG of ${model.record.manifestUrl}`, reason)
      }
    } catch (error) {
      return void refuse(String(error))
    }
    // A session opened meanwhile holds the model by its own open (`opened`).
    if (held.get(model) !== entry) return
    // It left the scene while it joined: parked as any model that leaves.
    setParked(model, entry, session, !members.has(model))
  }
  return {
    /** A session opens on `members`: every one of them is in it. */
    opened(members: Iterable<LoadedModel>) {
      held.clear()
      for (const model of members) held.set(model, { state: 'shown' })
    },
    /** Settles once the joins in flight have; none, nothing. */
    get flying() {
      return flights.size ? Promise.allSettled([...flights]) : undefined
    },
    /** The models the scene holds now against those the session holds: a new one joins, one that
     *  left is parked, one that returned is drawn again. */
    reconcile(members: ReadonlySet<LoadedModel>, session?: ModelSession) {
      if (!session) return
      for (const model of members) {
        const entry = held.get(model)
        if (!entry) {
          const joining: Held = { state: 'joining' }
          held.set(model, joining)
          const done = join(model, joining, session, members).finally(() => flights.delete(done))
          flights.add(done)
        } else if (entry.state === 'parked') setParked(model, entry, session, false)
      }
      for (const [model, entry] of held)
        if (!members.has(model) && entry.state === 'shown') setParked(model, entry, session, true)
    },
  }
}
