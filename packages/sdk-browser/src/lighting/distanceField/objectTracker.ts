import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import type { AtlasState } from './atlasState.ts'
import { flagsOf } from './objectCasting.ts'
import {
  addObject,
  createObjectTable,
  keyOf,
  measure,
  removeObject,
  rootVisible,
  takeModified,
  takeUpload,
  updateObject,
  type ObjectTable,
  type TrackedRoot,
} from './objectTable.ts'
import type { ObjectSource } from './objectRecords.ts'

export { CACHE_FULL, CACHE_STATIC, type ModifiedBoxes, type TrackedRoot } from './objectTable.ts'

/**
 * THE PLACEMENTS OF THE SCENE THAT HAVE A DISTANCE FIELD, kept level with the cut's roots. The
 * tracker reads the roots as they are — the rows their owners write, the worlds the engine moves —,
 * never changing them: a root whose mesh has a field is a placement of it (the roots that place the
 * same mesh at the same world, one for each primitive of a mesh, are one), and a placement is added,
 * updated or removed as its root appears, moves, is shown or hidden, starts or stops moving, or is
 * gone. A placement is added to the atlas's meshes (`AtlasState.reference`), a mesh freed when its
 * last placement is gone. The world DAG's root places no mesh: the HLOD cells' fields are placed by
 * stand-ins for it (`hlodObjects.ts`), while the cut draws their actors.
 *
 * Each change names the region of the world it changed, for the global field to composite again
 * (`takeModified`): the box of the placement added or removed; of one that moved, the box that
 * holds both its places if they are near, else both; of one that began or stopped moving, its box
 * in both kinds of cache. A world or a box that is not exactly the one the record last took names
 * its regions, however small the change; a root written again unchanged names none. A placement
 * larger than the radius the scene allows, or with a scale under 0.0001, is left out.
 */

/** What the tracker places a root as: the field of its mesh, or the one it stands in for. */
const wantedOf = (fields: ReadonlyMap<number, MeshDistanceField>, root: TrackedRoot) =>
  root.field ?? (root.mesh === undefined ? undefined : fields.get(root.mesh))

/** Reads the roots again as a whole: the placements gone removed, the new ones added. */
function resync(
  table: ObjectTable,
  fields: ReadonlyMap<number, MeshDistanceField>,
  roots: readonly TrackedRoot[],
  moving: (rank: number) => boolean,
  maxRadius: number,
) {
  const wanted = new Map<string, { rank: number; root: TrackedRoot; field: MeshDistanceField }>()
  roots.forEach((root, rank) => {
    const field = wantedOf(fields, root)
    const key = field && keyOf(field, root)
    if (key && !wanted.has(key)) wanted.set(key, { rank, root, field: field! })
  })
  const { objects } = table
  for (let at = objects.length - 1; at >= 0; at--) {
    const entry = objects[at]
    const same = wanted.get(entry.key)
    if (!same || same.field !== entry.field) removeObject(table, at)
    else {
      entry.root = same.root
      wanted.delete(entry.key)
      const state = { rank: same.rank, moving: moving(same.rank), maxRadius }
      if (!updateObject(table, entry, at, state)) removeObject(table, at)
    }
  }
  for (const { rank, root, field } of wanted.values()) {
    const box = measure(root, field, maxRadius)
    if (box) addObject(table, rank, root, field, box, moving(rank))
  }
}

/** Polls the placements held: false where a root is no longer the one that made it. */
function poll(
  table: ObjectTable,
  roots: readonly TrackedRoot[],
  moving: (rank: number) => boolean,
  maxRadius: number,
) {
  const { objects } = table
  for (let at = objects.length - 1; at >= 0; at--) {
    const entry = objects[at]
    const root = roots[entry.rank]
    if (root !== entry.root) return false
    const mv = moving(entry.rank)
    if (
      (root.worldAt ?? 0) === entry.version &&
      rootVisible(root) === entry.visible &&
      !!root.parked === entry.parked &&
      (root.mark ?? 0) === entry.mark &&
      mv === entry.moving
    )
      continue
    const state = { rank: entry.rank, moving: mv, maxRadius }
    if (!updateObject(table, entry, at, state)) removeObject(table, at)
  }
  return true
}

/** The tracker of a scene whose meshes' fields are `fields` (by compiled mesh), over `atlas`. */
export function createObjectTracker(
  fields: ReadonlyMap<number, MeshDistanceField>,
  atlas: AtlasState,
) {
  const table = createObjectTable(atlas)
  const { objects } = table
  let lastRoots: readonly TrackedRoot[] | undefined
  let lastCount = -1
  let lastEpoch = NaN
  return {
    objects,
    /** Brings the placements level with `roots`; `epoch` changes when the scene changed shape. */
    sync(
      roots: readonly TrackedRoot[],
      moving: (rank: number) => boolean,
      epoch: number,
      maxRadius: number,
    ) {
      const shaped = roots !== lastRoots || roots.length !== lastCount || epoch !== lastEpoch
      if (!shaped && poll(table, roots, moving, maxRadius)) return
      lastRoots = roots
      lastCount = roots.length
      lastEpoch = epoch
      resync(table, fields, roots, moving, maxRadius)
    },
    /** The record indices to write, ascending; the set is emptied. */
    takeUpload: () => takeUpload(table),
    /** Records not written this frame, to be written the next. */
    requeue(indices: readonly number[]) {
      indices.forEach((index) => table.upload.add(index))
    },
    /** The regions changed since the last call, per cache. */
    takeModified: () => takeModified(table),
    /** The source of object `index`'s records. */
    sourceOf(index: number): ObjectSource {
      const entry = objects[index]
      return {
        world: entry.root.world.elements,
        field: entry.field,
        asset: entry.asset,
        instance: entry.root.standsFor ?? entry.rank,
        flags: flagsOf(entry.visible, entry.parked, entry.moving, entry.mark),
        drawDistance: entry.root.drawDistance,
      }
    },
  }
}
