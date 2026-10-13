import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { createWorldCuts, type Cut } from './worldCuts.ts'
import { firstMaterial } from '../../scene/materialSide.ts'
import { createWorldMaterials, type MaterialEntry } from './worldMaterials.ts'
import { createWorldBatches } from './worldBatches.ts'
import { createWorldRanks } from './worldRanks.ts'
import { createWorldModels } from './worldModels.ts'
import { createWorldPoses, shownUnder } from './worldPoses.ts'
import { createModelJoins, type ModelSession } from './worldModelJoin.ts'
import { createWorldMembers } from './worldMembers.ts'
import { noticeFolds, noticeRefused, type WorldNotices } from '../diagnostic/worldNotices.ts'

type Resolved = { cut: Cut; entry: MaterialEntry } | null

/**
 * What a world's scene draws, held as tables: each mesh resolved to its geometry resource and
 * its material entry (`resolve`, asynchronous — a resource is cut off the frame), then seated on
 * a row of its batch (`seat`, synchronous, before a frame). What the scene gains after the session
 * opened joins it in place — full rows grown (`growHeld`), a resource it does not read handed to it
 * (`joinNew`), a model with its partitions (`worldModelJoin.ts`) —, and what the session cannot
 * take is said by name (`noticeRefused`): the scene never asks for an opening.
 */
export function createWorldContents(scene: Object3D, notices: WorldNotices) {
  const cuts = createWorldCuts(notices),
    materials = createWorldMaterials(),
    poses = createWorldPoses()
  const ranks = createWorldRanks()
  const refused = (what: string, reason: string) => noticeRefused(notices, what, reason)
  const worldModels = createWorldModels(ranks)
  const state: ContentsState = {
    ...{ scene, notices, cuts, materials, poses, ranks },
    models: worldModels,
    batches: createWorldBatches(
      poses.touch,
      (entry, cut, twoSided) => materials.surfaceOf(entry, cut.drawn, twoSided),
      ranks,
      refused,
    ),
    members: createWorldMembers(scene),
    joins: createModelJoins({ scene, models: worldModels, poses, refused }),
    resolved: new Map(),
    stale: new Set(),
    unseated: new Set(),
    held: new Set(),
    seatEpoch: 0,
  }
  const { batches, members, stale } = state
  return {
    cuts,
    /** The row each seated mesh holds. */
    seats: batches.seats,
    poses,
    get seatEpoch() {
      return state.seatEpoch
    },
    resolve: () => resolve(state),
    seat: (session?: ModelSession) => seat(state, session),
    /** A mesh's geometry or material was written: it is read again on the next resolve. */
    stale: (mesh: Mesh) => stale.add(mesh),
    get staleCount() {
      return stale.size
    },
    /** The material entries repainted in place since the last call (`worldMaterials.ts`). */
    repainted: materials.takeRepainted,
    /** Writes them into the surfaces built for them, then has the open session read them again
     *  (`MaterialsTable.repaint`). */
    repaint: materials.repaint,
    /** The world is gone: the surfaces and textures it built are given back. */
    dispose: materials.dispose,
    /** `parent`'s children changed: read at the next resolve. */
    changed: members.changed,
    /** A node entered the scene (`SceneLink.entered`). */
    entered: members.entered,
    /** Settles once the batches and models handed to the session have been taken or refused. */
    get joining() {
      const flying = [batches.flying, state.joins.flying].filter((flight) => !!flight)
      return flying.length ? Promise.all(flying) : undefined
    },
    plan: () => plan(state),
    /** The models' graphs and their rows (`worldModels.ts`). */
    models: state.models,
  }
}

/** What a world's contents hold (`createWorldContents`). */
type ContentsState = {
  scene: Object3D
  notices: WorldNotices
  cuts: ReturnType<typeof createWorldCuts>
  materials: ReturnType<typeof createWorldMaterials>
  poses: ReturnType<typeof createWorldPoses>
  batches: ReturnType<typeof createWorldBatches>
  ranks: ReturnType<typeof createWorldRanks>
  models: ReturnType<typeof createWorldModels>
  members: ReturnType<typeof createWorldMembers>
  joins: ReturnType<typeof createModelJoins>
  resolved: Map<Mesh, Resolved>
  stale: Set<Mesh>
  unseated: Set<Mesh>
  /** The resources the open session reads: their pages stay served. */
  held: Set<Cut>
  /** Moves whenever a seat may have changed (`SceneLink.seatEpoch`). */
  seatEpoch: number
}

function forget(state: ContentsState, mesh: Mesh) {
  state.seatEpoch++
  state.resolved.delete(mesh)
  state.unseated.delete(mesh)
  state.cuts.leave(mesh)
  state.batches.unseat(mesh)
}

/** Resolves the meshes that entered the scene or were written; forgets those that left.
 *  True when a light entered or left with them. */
async function resolve(state: ContentsState) {
  const { members, stale, cuts, materials } = state
  const { added, removed, lights } = members.take()
  removed.forEach((mesh) => forget(state, mesh))
  const reading = [...new Set([...added, ...stale])].filter((mesh) => members.meshes.has(mesh))
  stale.clear()
  // Every resource is read at once; the meshes are then seated in the order they came. A read
  // that throws leaves them all to the next resolution.
  const read = await Promise.all(reading.map((mesh) => cuts.of(mesh))).catch((error) => {
    reading.forEach((mesh) => stale.add(mesh))
    throw error
  })
  reading.forEach((mesh, i) => {
    const cut = read[i]
    if (!members.meshes.has(mesh)) return forget(state, mesh)
    state.resolved.set(
      mesh,
      cut && { cut, entry: materials.entryOf(firstMaterial(mesh.material)!) },
    )
    state.unseated.add(mesh)
  })
  // What the tables folded is said once, with the count of the burst that folded it.
  const folded = { geometries: cuts.counts.duplicates, materials: materials.counts.duplicates }
  noticeFolds(state.notices, folded)
  return lights
}

/** Writes a seated mesh's world matrix and flag into its row. */
function writeRow({ poses, batches, scene }: ContentsState, mesh: Mesh) {
  mesh.updateWorldMatrix(true, false)
  poses.writeSeat(mesh, batches.seats.get(mesh)!, shownUnder(mesh, scene))
}

/**
 * Seats the meshes waiting in batches the session holds, their rows grown in place where the
 * session takes it (`grow`), each grown buffer's every row then sent again, and each mesh seated
 * writes its row.
 */
function growHeld(state: ContentsState, grow?: ModelSession) {
  const seated: Mesh[] = []
  for (const batch of state.batches.growHeld((mesh) => seated.push(mesh), grow))
    state.poses.touchRange(batch, 0, batch.rows!.capacity - 1)
  seated.forEach((mesh) => writeRow(state, mesh))
}

/** Seats the meshes resolved since the last call, writing the rows that were free, then — on a
 *  session that grows its buffers, `grow` — those a full buffer made wait. A blended or
 *  transmissive surface takes a row like any other: the session draws each row of it as its own
 *  blended draw, ordered by depth. */
function seat(state: ContentsState, session?: ModelSession) {
  const { batches, unseated } = state
  state.seatEpoch++
  growHeld(state, session) // the meshes that waited first: a row freed since goes to them before new ones
  const seating = [...unseated]
  unseated.clear()
  for (const mesh of seating) {
    const entry = state.resolved.get(mesh)
    if (entry === undefined) continue
    if (!entry) {
      batches.unseat(mesh)
      continue
    }
    if (batches.seat(mesh, entry.cut, entry.entry)) writeRow(state, mesh)
  }
  growHeld(state, session)
  joinNew(state, session)
  state.joins.reconcile(state.members.models, session)
}

/** The batches the session was not opened with join it, their rows written first. */
function joinNew(state: ContentsState, grow?: ModelSession) {
  const seated: Mesh[] = []
  for (const batch of state.batches.join((mesh) => seated.push(mesh), grow)) {
    state.poses.touchRange(batch, 0, batch.rows!.capacity - 1)
    // The session reads its resource from now on: its pages stay served, its rewritten vertices
    // are sent it (`Cut.held`).
    state.cuts.hold(batch.cut, true)
    state.held.add(batch.cut)
  }
  seated.forEach((mesh) => writeRow(state, mesh))
}

/** Sizes the batches and gathers what the next session opens on; marks it opened. Holds the
 *  resources it reads; `release` lets go of those only the session before read, once closed. */
function plan(state: ContentsState) {
  const { batches, scene, poses, members, cuts } = state
  state.seatEpoch++
  const kept = batches.reopen()
  scene.updateMatrixWorld()
  for (const batch of kept)
    batch.owners.forEach(
      (mesh, row) => mesh && poses.writeSeat(mesh, { batch, row }, shownUnder(mesh, scene)),
    )
  for (const model of members.models) {
    state.models.rootsOf(model) // its draws, its world DAG's pose among them: written with them
    poses.writeModel(state.models, model, shownUnder(model, scene))
  }
  poses.settle()
  state.joins.opened(members.models)
  const used = new Set<MaterialEntry>(
    [...state.resolved.values()].flatMap((r) => (r ? [r.entry] : [])),
  )
  state.materials.keep(used)
  const next = new Set(kept.map((batch) => batch.cut))
  for (const cut of next) cuts.hold(cut, true)
  const release = () => {
    for (const cut of state.held) if (!next.has(cut)) cuts.hold(cut, false)
    state.held = next
  }
  return {
    ...{ batches: kept, models: [...members.models], ranks: state.ranks },
    worldModels: state.models,
    release,
  }
}
