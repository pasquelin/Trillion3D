import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import type { PlacementGrowth } from '../../../placement/engineSceneUpdates.ts'
import type { PartitionCells } from '../../../geometry/partition/cells.ts'
import type { WorldRootsHold } from '../../../geometry/hlod/worldRoots.ts'
import { primitiveFinder } from '../../../scene/primitiveLookup.ts'
import { modelPartitions, type LoadedModel, type ModelRecord } from './loadedModel.ts'
import type { WorldModels } from './models.ts'
import type { createWorldPoses } from '../poses/poses.ts'
import { rootedUnder } from '../../../scene/host/world/rooted.ts'
import { createDeferred } from '../../../../../sdk-core/src/runtime/deferred.ts'

/** What a running session lends the models joining it: the engine's growth, and the partitions it
 *  follows (`api/sceneApi.ts`). */
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
    poses.writeModel(models, model, rootedUnder(model, scene, true))
  }
  /** Parks `model`, which the scene lost — rows down, cells given back —, or draws it again, the
   *  scene took it back. */
  const setParked = (model: LoadedModel, entry: Held, session: ModelSession, parked: boolean) => {
    const partitions = modelPartitions(model)
    entry.state = parked ? 'parked' : 'shown'
    write(model)
    if (!partitions.length) return
    if (parked) session.leavePartitions?.(partitions)
    else session.followPartitions?.(partitions)
  }
  /** Once `model` joined: parked if it left the scene meanwhile, drawn else — unless a session
   *  opened meanwhile holds it by its own open (`opened`). */
  const settle = (
    model: LoadedModel,
    entry: Held,
    session: ModelSession,
    members: ReadonlySet<LoadedModel>,
  ) => {
    if (held.get(model) === entry) setParked(model, entry, session, !members.has(model))
  }
  /** Why the session cannot follow `model`'s partitions, if it cannot. */
  const unfollowed = (model: LoadedModel, session: ModelSession) =>
    modelPartitions(model).length && !session.preparePartitions
      ? 'the session follows no partition added to it'
      : undefined
  /** Why `model` cannot be handed to the session, if it cannot. */
  const unfit = (model: LoadedModel, session: ModelSession) =>
    !session.addPlacements ? 'the session takes no source in place' : unfollowed(model, session)
  /** The join of each record the session holds or takes: a later placement of it waits for it,
   *  then adds its rows alone. */
  const records = new Map<ModelRecord, Promise<boolean>>()
  /** Hands the model's content to the session: its cells first, then each source — or, a
   *  placement of a record the session holds already (`placeModel`), its rows and its cells
   *  alone: its sources, pages, images and world DAG are the session's already, its instance of
   *  the world DAG a row of its poses. */
  async function join(
    model: LoadedModel,
    entry: Held,
    session: ModelSession,
    members: ReadonlySet<LoadedModel>,
  ) {
    const refuse = (reason: string) => {
      if (held.get(model) !== entry) return // a session opened meanwhile holds the model by its open
      entry.state = 'refused'
      refused(`the model ${model.record.manifestUrl}`, reason)
    }
    // A throw anywhere refuses the model by name: it never stays joining, and its join settles.
    try {
      const partitions = modelPartitions(model)
      const taken = records.get(model.record)
      if (taken) {
        if (!(await taken)) return void refuse('the session refused the model it places again')
        const why = unfollowed(model, session)
        if (why) return void refuse(why)
        // Its row of each source and of the world DAG's poses: a row past their buffers grows
        // them, and the session adds a root per new row — a new instance of the world DAG among
        // them.
        const grown = models.place(model, session)
        if (grown) return void refuse(grown)
        write(model)
        if (partitions.length) await session.preparePartitions!(partitions, [])
        return settle(model, entry, session, members)
      }
      const { promise, resolve: took } = createDeferred<boolean>()
      records.set(model.record, promise)
      // Settled whatever happens, a throw included: a later placement of the record never waits
      // on a join that will not end.
      let joined = false
      try {
        joined = await content(model, entry, session, members, partitions, refuse)
      } finally {
        took(joined)
        if (!joined) records.delete(model.record)
      }
    } catch (error) {
      refuse(String(error))
    }
  }
  /** The content of a record the session does not hold yet, handed through `model`: true once
   *  the session holds its sources. */
  async function content(
    model: LoadedModel,
    entry: Held,
    session: ModelSession,
    members: ReadonlySet<LoadedModel>,
    partitions: ReturnType<typeof modelPartitions>,
    refuse: (reason: string) => void,
  ) {
    try {
      const why = unfit(model, session)
      if (why) return (refuse(why), false)
      const { primitives, draws } = models.drawsOf(model)
      const roots = models.rootsOf(model) // its world DAG's pose is written with its meshes'
      write(model)
      // Its textures read the levels its own cache baked, as the open's read the session's.
      session.addTextureCaches?.(model.record.scene.textureCaches)
      const find = primitiveFinder(primitives)
      if (partitions.length) await session.preparePartitions!(partitions, roots)
      for (const source of draws) {
        const primitive = find({ meshes: source.mesh, primitives: source.primitives })
        const reason = !primitive
          ? `no primitive for mesh ${source.mesh}/${source.primitives ?? 0}`
          : await session.addPlacements!(source, primitive)
        if (reason) return (refuse(reason), false)
      }
      // Its world DAG, once its sources wear its pages: the session draws it by the cut made over
      // every root. Refused, the cells are drawn by their objects alone, and it is said.
      for (const hold of roots) {
        const reason = await session.addWorldRoots?.(hold)
        if (reason) refused(`the world DAG of ${model.record.manifestUrl}`, reason)
      }
    } catch (error) {
      return (refuse(String(error)), false)
    }
    settle(model, entry, session, members)
    return true
  }
  return {
    /** A session opens on `members`: every one of them is in it. */
    opened(members: Iterable<LoadedModel>) {
      held.clear()
      records.clear()
      for (const model of members) {
        held.set(model, { state: 'shown' })
        records.set(model.record, Promise.resolve(true))
      }
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
