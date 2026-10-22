import { length3 } from '../../../../math/src/vector/vector.ts'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import type { AtlasState } from './atlasState.ts'
import { OBJECT_FLAGS } from './layout.ts'
import { minimumAxisScale, objectWorldBox, type ObjectSource } from './objectRecords.ts'

/**
 * THE PLACEMENTS OF THE SCENE THAT HAVE A DISTANCE FIELD, kept level with the cut's roots. The
 * tracker reads the roots as they are — the rows their owners write, the worlds the engine moves —,
 * never changing them: a root whose mesh has a field is a placement of it (the roots that place the
 * same mesh at the same world, one for each primitive of a mesh, are one), and a placement is added,
 * updated or removed as its root appears, moves, is shown or hidden, starts or stops moving, or is
 * gone. A placement is added to the atlas's meshes (`AtlasState.reference`), a mesh freed when its
 * last placement is gone.
 *
 * Each change names the region of the world it changed, for the global field to composite again
 * (`takeModified`): the box of the placement added or removed; of one that moved, the box that
 * holds both its places if they are near, else both; of one that began or stopped moving, its box
 * in both kinds of cache. A move of less than a hundredth of a centimetre, or of a hundredth of a
 * unit of scale, writes its record again and names no region. A placement larger than the radius
 * the scene allows, or with a scale under 0.0001, is left out.
 */

/** What the tracker reads of a cut's root. */
export interface TrackedRoot {
  readonly mesh?: number
  readonly world: { readonly elements: ArrayLike<number> }
  readonly worldAt?: number
  readonly parked?: boolean
  readonly hidden?: boolean
  readonly drawDistance?: { readonly min: number; readonly max: number }
}

/** A placement in the scene's table. */
interface TrackedObject {
  root: TrackedRoot
  rank: number
  readonly field: MeshDistanceField
  readonly asset: number
  version: number
  visible: boolean
  moving: boolean
  /** The world box, centimetres, and the world matrix, as the records last took them. */
  box: Float64Array
  world: Float64Array
  key: string
}

/** The two kinds of cache the global field keeps: the mostly static meshes', then the full one. */
export const CACHE_STATIC = 0
export const CACHE_FULL = 1

/** The regions changed since they were last taken, a flat list of boxes (six numbers each) for each cache. */
export type ModifiedBoxes = [number[], number[]]

/** Everything a placement is told apart by: its mesh and its world. */
const keyOf = (mesh: number, m: ArrayLike<number>) =>
  `${mesh}:${Array.from({ length: 16 }, (_, k) => m[k]).join(',')}`

const rootVisible = (root: TrackedRoot) => !(root.parked || root.hidden)

const flagsOf = (visible: boolean, moving: boolean) =>
  (moving ? OBJECT_FLAGS.oftenMoving : 0) |
  OBJECT_FLAGS.castShadow |
  OBJECT_FLAGS.virtualized |
  (visible ? OBJECT_FLAGS.visible : 0)

const halfExtent = (box: ArrayLike<number>, k: number) => 0.5 * (box[3 + k] - box[k])

/** Whether two worlds differ by no more than a hundredth, a position in centimetres. */
function sameWorld(a: ArrayLike<number>, b: ArrayLike<number>) {
  for (let k = 0; k < 16; k++)
    if (Math.abs(a[k] - b[k]) * (k >= 12 && k < 15 ? CM : 1) > 0.01) return false
  return true
}

const sameExtent = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  [0, 1, 2].every((k) => Math.abs(halfExtent(a, k) - halfExtent(b, k)) <= 0.01)

/** The box that holds both, and whether it grows no half-extent by 100 over the two. */
function holding(a: ArrayLike<number>, b: ArrayLike<number>) {
  const box = Array.from({ length: 6 }, (_, k) =>
    k < 3 ? Math.min(a[k], b[k]) : Math.max(a[k], b[k]),
  )
  const near = [0, 1, 2].every(
    (k) => halfExtent(box, k) - halfExtent(a, k) - halfExtent(b, k) < 100,
  )
  return { box, near }
}

/** The tracker of a scene whose meshes' fields are `fields` (by compiled mesh), over `atlas`. */
export function createObjectTracker(
  fields: ReadonlyMap<number, MeshDistanceField>,
  atlas: AtlasState,
) {
  /** The objects in the order of the GPU's records; a removed one is replaced by the last. */
  const objects: TrackedObject[] = []
  const upload = new Set<number>()
  const modified: ModifiedBoxes = [[], []]
  let lastRoots: readonly TrackedRoot[] | undefined
  let lastCount = -1
  let lastEpoch = NaN

  const note = (caches: readonly number[], box: ArrayLike<number>) =>
    caches.forEach((cache) => modified[cache].push(...Array.from(box)))
  const cacheOf = (moving: boolean) => (moving ? CACHE_FULL : CACHE_STATIC)

  /** The world box of a root's placement, none where the scene leaves it out. */
  function measure(root: TrackedRoot, field: MeshDistanceField, maxRadius: number) {
    if (!(minimumAxisScale(root.world.elements) >= 0.0001)) return undefined
    const box = objectWorldBox(new Float64Array(6), root.world.elements, field)
    return length3(halfExtent(box, 0), halfExtent(box, 1), halfExtent(box, 2)) < maxRadius
      ? box
      : undefined
  }

  function remove(at: number) {
    const gone = objects[at]
    note([cacheOf(gone.moving)], gone.box)
    atlas.release(gone.asset)
    const last = objects.pop()!
    if (last !== gone) {
      objects[at] = last
      upload.add(at)
    }
    upload.delete(objects.length)
  }

  function add(
    rank: number,
    root: TrackedRoot,
    field: MeshDistanceField,
    box: Float64Array,
    moving: boolean,
  ) {
    const key = keyOf(field.mesh, root.world.elements)
    const entry: TrackedObject = {
      root,
      rank,
      field,
      key,
      box,
      moving,
      asset: atlas.reference(field),
      version: root.worldAt ?? 0,
      visible: rootVisible(root),
      world: Float64Array.from({ length: 16 }, (_, k) => root.world.elements[k]),
    }
    upload.add(objects.length)
    objects.push(entry)
    note([cacheOf(moving)], box)
  }

  /** `entry` taken to the state of its root; false where the scene no longer keeps it. */
  function update(
    entry: TrackedObject,
    at: number,
    rank: number,
    moving: boolean,
    maxRadius: number,
  ) {
    const box = measure(entry.root, entry.field, maxRadius)
    if (!box) return false
    const visible = rootVisible(entry.root)
    const flipped = entry.moving !== moving
    const moved = !sameWorld(entry.world, entry.root.world.elements) || !sameExtent(entry.box, box)
    if (flipped || moved || entry.visible !== visible) {
      const both = holding(entry.box, box)
      const caches = flipped ? [CACHE_STATIC, CACHE_FULL] : [cacheOf(moving)]
      if (!moved || both.near) note(caches, moved ? both.box : box)
      else {
        note(caches, entry.box)
        note(caches, box)
      }
    }
    entry.world.set(Array.from({ length: 16 }, (_, k) => entry.root.world.elements[k]))
    Object.assign(entry, { rank, version: entry.root.worldAt ?? 0, visible, moving, box })
    entry.key = keyOf(entry.field.mesh, entry.root.world.elements)
    upload.add(at)
    return true
  }

  /** Reads the roots again as a whole: the placements gone removed, the new ones added. */
  function resync(
    roots: readonly TrackedRoot[],
    moving: (rank: number) => boolean,
    maxRadius: number,
  ) {
    const wanted = new Map<string, { rank: number; root: TrackedRoot; field: MeshDistanceField }>()
    roots.forEach((root, rank) => {
      const field = root.mesh === undefined ? undefined : fields.get(root.mesh)
      const key = field && keyOf(root.mesh!, root.world.elements)
      if (key && !wanted.has(key)) wanted.set(key, { rank, root, field: field! })
    })
    for (let at = objects.length - 1; at >= 0; at--) {
      const entry = objects[at]
      const same = wanted.get(entry.key)
      if (!same || same.field !== entry.field) remove(at)
      else {
        entry.root = same.root
        wanted.delete(entry.key)
        if (!update(entry, at, same.rank, moving(same.rank), maxRadius)) remove(at)
      }
    }
    for (const { rank, root, field } of wanted.values()) {
      const box = measure(root, field, maxRadius)
      if (box) add(rank, root, field, box, moving(rank))
    }
  }

  /** Polls the placements held: false where a root is no longer the one that made it. */
  function poll(
    roots: readonly TrackedRoot[],
    moving: (rank: number) => boolean,
    maxRadius: number,
  ) {
    for (let at = objects.length - 1; at >= 0; at--) {
      const entry = objects[at]
      const root = roots[entry.rank]
      if (root !== entry.root) return false
      const mv = moving(entry.rank)
      if (
        (root.worldAt ?? 0) === entry.version &&
        rootVisible(root) === entry.visible &&
        mv === entry.moving
      )
        continue
      if (!update(entry, at, entry.rank, mv, maxRadius)) remove(at)
    }
    return true
  }

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
      if (!shaped && poll(roots, moving, maxRadius)) return
      lastRoots = roots
      lastCount = roots.length
      lastEpoch = epoch
      resync(roots, moving, maxRadius)
    },
    /** The record indices to write, ascending; the set is emptied. */
    takeUpload() {
      const indices = [...upload].filter((i) => i < objects.length).sort((a, b) => a - b)
      upload.clear()
      return indices
    },
    /** Records not written this frame, to be written the next. */
    requeue(indices: readonly number[]) {
      indices.forEach((index) => upload.add(index))
    },
    /** The regions changed since the last call, per cache. */
    takeModified(): ModifiedBoxes {
      return [modified[0].splice(0), modified[1].splice(0)]
    },
    /** The source of object `index`'s records. */
    sourceOf(index: number): ObjectSource {
      const entry = objects[index]
      return {
        world: entry.root.world.elements,
        field: entry.field,
        asset: entry.asset,
        instance: entry.rank,
        flags: flagsOf(entry.visible, entry.moving),
        drawDistance: entry.root.drawDistance,
      }
    },
  }
}

export type ObjectTracker = ReturnType<typeof createObjectTracker>
