import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { createWorldCuts, firstMaterial, type Cut } from './worldCuts.ts'
import { createWorldMaterials, type MaterialEntry } from './worldMaterials.ts'
import { createWorldBatches } from './worldBatches.ts'
import { createWorldPoses, shownUnder } from './worldPoses.ts'
import type { LoadedModel } from './loadedModel.ts'
import type { PlacementGrowth } from '../../placement/engineSceneUpdates.ts'
import { createWorldMembers } from './worldMembers.ts'
import { noticeFolds, type WorldNotices } from '../diagnostic/worldNotices.ts'

type Resolved = { cut: Cut; entry: MaterialEntry } | null

/**
 * What a world's scene draws, held as tables: each mesh resolved to its geometry resource and
 * its material entry (`resolve`, asynchronous — a resource is cut off the frame), then seated on
 * a row of its batch (`seat`, synchronous, before a frame). `openedModels` is what the session in
 * place was built from; `reopenNeeded` says the scene now asks for something it does not hold — full
 * rows excepted, which `growHeld` grows in place on a session that can: a resource the session was
 * not opened with, a model it does not read.
 */
export function createWorldContents(scene: Object3D, notices: WorldNotices) {
  const cuts = createWorldCuts(notices),
    materials = createWorldMaterials(),
    poses = createWorldPoses()
  const state: ContentsState = {
    ...{ scene, notices, cuts, materials, poses },
    batches: createWorldBatches(poses.touch),
    members: createWorldMembers(scene),
    resolved: new Map(),
    stale: new Set(),
    unseated: new Set(),
    openedModels: new Set(),
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
    seat: (grow?: PlacementGrowth) => seat(state, grow),
    /** A mesh's geometry or material was written: it is read again on the next resolve. */
    stale: (mesh: Mesh) => stale.add(mesh),
    get staleCount() {
      return stale.size
    },
    /** The material entries repainted in place since the last call (`worldMaterials.ts`). */
    repainted: materials.takeRepainted,
    /** `parent`'s children changed: read at the next resolve. */
    changed: members.changed,
    /** A node entered the scene (`SceneLink.entered`). */
    entered: members.entered,
    reopenNeeded: () => batches.waiting() || !same(state.openedModels, members.models),
    plan: () => plan(state),
    shown: (node: Object3D) => shownUnder(node, scene),
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
  members: ReturnType<typeof createWorldMembers>
  resolved: Map<Mesh, Resolved>
  stale: Set<Mesh>
  unseated: Set<Mesh>
  openedModels: Set<LoadedModel>
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
    state.resolved.set(mesh, cut && { cut, entry: materials.entryOf(firstMaterial(mesh.material)) })
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
function growHeld(state: ContentsState, grow?: PlacementGrowth) {
  const seated: Mesh[] = []
  for (const batch of state.batches.growHeld((mesh) => seated.push(mesh), grow))
    state.poses.touchRange(batch, 0, batch.rows!.capacity - 1)
  seated.forEach((mesh) => writeRow(state, mesh))
}

/** Seats the meshes resolved since the last call, writing the rows that were free, then — on a
 *  session that grows its buffers, `grow` — those a full buffer made wait. A blended or
 *  transmissive surface takes a row like any other: the session draws each row of it as its own
 *  blended draw, ordered by depth. */
function seat(state: ContentsState, grow?: PlacementGrowth) {
  const { batches, unseated } = state
  state.seatEpoch++
  growHeld(state, grow) // the meshes that waited first: a row freed since goes to them before new ones
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
  growHeld(state, grow)
}

const same = <T>(a: ReadonlySet<T>, b: Iterable<T>) => {
  let n = 0
  for (const item of b) if (!a.has(item) || ++n > a.size) return false
  return n === a.size
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
  poses.settle()
  state.openedModels = new Set(members.models)
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
  return { batches: kept, models: [...members.models], release }
}
